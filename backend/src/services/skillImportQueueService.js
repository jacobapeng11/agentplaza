const crypto = require('node:crypto');
const os = require('node:os');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const SkillImportJob = require('../models/SkillImportJob');
const { parseSkillArchive, MAX_ARCHIVE_BYTES, SkillArchiveError } = require('./skillArchiveParser');
const { limitSkillBytes, openSkillObject, uploadSkillObject } = require('./skillStorage');
const logger = require('../utils/logger');

const jobTtlMs = 7 * 24 * 60 * 60 * 1000;
const staleLockMs = 10 * 60 * 1000;
const maxAttempts = 3;

function createImportJob({ user, packageInfo, tags }) {
  const operator = {
    badge: String(user.Badge || ''),
    name: String(user.Name || ''),
    departmentCode: String(user.DepartmentCode || '')
  };
  if (!operator.badge) throw new Error('无法识别当前上传用户');
  return SkillImportJob.create({
    jobId: 'skill_' + crypto.randomUUID(),
    operator,
    sourceType: 'zip',
    package: packageInfo,
    defaults: { tags },
    progress: 5,
    expiresAt: new Date(Date.now() + jobTtlMs)
  });
}

async function claimNextImportJob(workerId) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleLockMs);
  await SkillImportJob.updateMany({
    sourceType: 'zip', status: 'processing', attempts: { $gte: maxAttempts }, lockedAt: { $lt: staleBefore }
  }, { $set: {
    status: 'failed', stage: 'parse_failed', progress: 100, lockedAt: null, lockedBy: '',
    error: { code: 'PARSE_ATTEMPTS_EXHAUSTED', message: '解析未完成，请重新上传 ZIP' }
  } });
  return SkillImportJob.findOneAndUpdate({
    sourceType: 'zip',
    attempts: { $lt: maxAttempts },
    nextRunAt: { $lte: now },
    $or: [{ status: 'queued' }, { status: 'processing', lockedAt: { $lt: staleBefore } }]
  }, {
    $set: { status: 'processing', stage: 'acquiring_package', progress: 12, lockedAt: now, lockedBy: workerId },
    $inc: { attempts: 1 }
  }, { new: true, sort: { createdAt: 1 } });
}

function updateClaimedJob(job, patch) {
  return SkillImportJob.updateOne({
    _id: job._id, status: 'processing', lockedBy: job.lockedBy, attempts: job.attempts
  }, { $set: { lockedAt: new Date(), ...patch } });
}

async function downloadArchive(packageInfo) {
  const { stream } = await openSkillObject(packageInfo, { kind: 'imports', maxBytes: MAX_ARCHIVE_BYTES });
  const chunks = [];
  await pipeline(stream, limitSkillBytes(MAX_ARCHIVE_BYTES), new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    }
  }));
  return Buffer.concat(chunks);
}

async function uploadSkillArtifacts(job, parsed) {
  const artifacts = new Map(parsed.artifacts.map(artifact => [artifact.itemKey, artifact]));
  for (let index = 0; index < parsed.items.length; index += 1) {
    const item = parsed.items[index];
    const awaiting = await updateClaimedJob(job, {
      stage: 'uploading_skill_artifacts',
      progress: 55 + Math.floor(index / parsed.items.length * 20)
    });
    if (!awaiting.matchedCount) return false;
    const artifact = artifacts.get(item.itemKey);
    const archive = await uploadSkillObject({
      buffer: artifact.buffer, size: artifact.size, originalName: item.name + '.zip'
    }, 'skills/artifacts/' + job.jobId + '/' + item.itemKey + '.zip');
    item.package = { ...archive, sha256: artifact.sha256 };
  }
  return true;
}

async function processImportJob(job) {
  try {
    const input = await downloadArchive(job.package);
    const progress = await updateClaimedJob(job, { stage: 'parsing_archive', progress: 45, downloadedBytes: input.length });
    if (!progress.matchedCount) return;
    const parsed = await parseSkillArchive(input);
    if (!await uploadSkillArtifacts(job, parsed)) return;
    await updateClaimedJob(job, {
      'package.sha256': parsed.archiveHash, 'package.size': parsed.archiveSize,
      parseItems: parsed.items, status: 'ready', stage: 'waiting_for_confirmation', progress: 80,
      lockedAt: null, lockedBy: '', error: { code: '', message: '' }
    });
  } catch (error) {
    const invalidArchive = error instanceof SkillArchiveError || error.statusCode === 413;
    const canRetry = !invalidArchive && job.attempts < maxAttempts;
    const failure = invalidArchive ? error : { code: 'SKILL_PARSE_UNAVAILABLE', message: '暂时无法解析 Skill ZIP' };
    await updateClaimedJob(job, {
      status: canRetry ? 'queued' : 'failed',
      stage: canRetry ? 'retry_wait' : 'parse_failed',
      progress: canRetry ? 8 : 100,
      nextRunAt: new Date(Date.now() + Math.min(60000, 5000 * (2 ** job.attempts))),
      lockedAt: null,
      lockedBy: '',
      error: { code: failure.code, message: failure.message }
    });
  }
}

function startSkillParserWorker() {
  const configured = Number(process.env.SKILL_PARSER_POLL_MS);
  const pollIntervalMs = Number.isSafeInteger(configured) && configured >= 500 ? configured : 2000;
  const workerId = os.hostname() + ':' + process.pid + ':' + crypto.randomUUID();
  let running = null;
  let timer = null;
  let stopped = false;

  function tick() {
    running = (async () => {
      try {
        const job = await claimNextImportJob(workerId);
        if (job) await processImportJob(job);
      } catch (error) {
        logger.warn('Skill parser could not process queue:', error.name);
      } finally {
        if (!stopped) timer = setTimeout(tick, pollIntervalMs);
      }
    })();
  }

  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    return running;
  };
}

module.exports = { createImportJob, startSkillParserWorker };
