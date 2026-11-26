const crypto = require('crypto');
const Skill = require('../models/Skill');
const SkillVersion = require('../models/SkillVersion');
const SkillImportJob = require('../models/SkillImportJob');
const SkillSubmission = require('../models/SkillSubmission');

const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLISH_LOCK_MS = 10 * 60 * 1000;

const CATEGORY_ALIASES = new Map([
  ['market', 'market'], ['大市场', 'market'],
  ['finance', 'finance'], ['财经类', 'finance'], ['财经', 'finance'],
  ['office', 'office'], ['办公类', 'office'], ['办公', 'office'],
  ['administration', 'administration'], ['admin', 'administration'], ['行政类', 'administration'], ['行政', 'administration'],
  ['research', 'research'], ['dev', 'research'], ['研发类', 'research'], ['研发', 'research'],
  ['general', 'general'], ['综合类', 'general'], ['综合', 'general']
]);

class SkillVersionError extends Error {
  constructor(message, statusCode = 400, code = 'SKILL_VERSION_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeSkillName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

function normalizeCategory(value) {
  return CATEGORY_ALIASES.get(String(value || '').trim()) || 'general';
}

function requireCategory(value) {
  if (!Skill.SKILL_CATEGORIES.includes(value)) throw new SkillVersionError('请选择有效的 Skill 分类', 400, 'INVALID_SKILL_CATEGORY');
  return value;
}

function normalizeTags(value) {
  const tags = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 10);
}

function parseSemver(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function nextPatchVersion(value) {
  const parsed = parseSemver(value) || [1, 0, -1];
  return `${parsed[0]}.${parsed[1]}.${parsed[2] + 1}`;
}

function resolveVersion(manifestVersion, currentVersion) {
  if (!currentVersion) return parseSemver(manifestVersion) ? String(manifestVersion).replace(/^v/, '') : '1.0.0';
  if (parseSemver(manifestVersion) && compareSemver(manifestVersion, currentVersion) > 0) {
    return String(manifestVersion).replace(/^v/, '');
  }
  return nextPatchVersion(currentVersion);
}

function buildSlug(name, identityKey) {
  const base = String(name || 'skill')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54) || 'skill';
  return `${base}-${crypto.createHash('sha1').update(identityKey).digest('hex').slice(0, 8)}`;
}

async function findMatchingSkill(parseItem, scope) {
  const eligible = { ...scope, status: { $ne: 'deleted' } };
  if (parseItem.manifestId) {
    return Skill.findOne({ ...eligible, manifestId: String(parseItem.manifestId) }).sort({ updatedAt: -1 });
  }

  const normalizedName = normalizeSkillName(parseItem.name);
  const byName = await Skill.findOne({ ...eligible, normalizedName }).sort({ updatedAt: -1 });
  if (byName) return byName;

  if (parseItem.contentFingerprint) {
    const skillIds = await SkillVersion.distinct('skillId', { contentFingerprint: parseItem.contentFingerprint });
    return Skill.findOne({ ...eligible, _id: { $in: skillIds } }).sort({ updatedAt: -1 });
  }
  return null;
}

async function createOrUpgradeSkill({ parseItem, selection, user }) {
  const name = String(selection.name || parseItem.name || '').trim().slice(0, 120);
  if (!name) throw new SkillVersionError('Skill 名称不能为空');
  const category = requireCategory(selection.category);
  const artifactPackage = parseItem.package;
  if (!artifactPackage?.bucket || !artifactPackage?.objectKey || !artifactPackage?.sha256) {
    throw new SkillVersionError('Skill 独立制品不存在，请重新解析后提交', 409, 'SKILL_ARTIFACT_NOT_FOUND');
  }

  const normalizedName = normalizeSkillName(name);
  const manifestId = parseItem.manifestId ? String(parseItem.manifestId).trim() : null;
  const badge = String(user.Badge || user.badge || user.userId || '');
  const owner = {
    badge,
    name: String(user.Name || user.name || ''),
    departmentCode: String(user.DepartmentCode || user.departmentCode || '')
  };
  const source = { type: 'zip' };
  const scope = { 'source.type': source.type, 'owner.badge': badge };
  let skill = await findMatchingSkill({ ...parseItem, name, manifestId }, scope);

  if (!skill) {
    const identityKey = JSON.stringify([source.type, badge, manifestId ? 'id' : 'name', manifestId || normalizedName]);
    const initial = {
      identityKey,
      manifestId,
      slug: buildSlug(name, identityKey),
      name,
      normalizedName,
      summary: String(selection.summary || parseItem.summary || '').trim().slice(0, 1000),
      category,
      tags: normalizeTags(selection.tags?.length ? selection.tags : parseItem.tags),
      track: selection.official ? 'official' : 'community',
      visibility: 'organization',
      status: 'processing',
      currentVersion: '0.0.0',
      owner,
      source,
      security: { status: 'pending', warnings: parseItem.warnings || [] }
    };
    try {
      skill = await Skill.findOneAndUpdate({ identityKey }, { $setOnInsert: initial }, { upsert: true, new: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      skill = await Skill.findOne({ identityKey });
      if (!skill) throw error;
    }
    if (skill.status === 'deleted') throw new SkillVersionError('该 Skill 已删除', 409);
  }

  if (skill.status === 'pending_review') {
    throw new SkillVersionError('请先审批该 Skill 已发布过的版本', 409, 'SKILL_EXISTING_REVIEW_REQUIRED');
  }
  const canPublish = { $nin: ['deleted', 'pending_review'] };
  const packageFilter = {
    skillId: skill._id,
    'package.sha256': artifactPackage.sha256,
    sourcePath: parseItem.sourcePath
  };
  const versionData = {
    manifestId,
    sourcePath: parseItem.sourcePath,
    status: 'published',
    changeLog: String(selection.changeLog || '').trim().slice(0, 1000),
    skillMdContent: parseItem.skillMdContent,
    parsedMetadata: parseItem.parsedMetadata || {},
    package: {
      bucket: artifactPackage.bucket,
      objectKey: artifactPackage.objectKey,
      originalName: artifactPackage.originalName,
      size: artifactPackage.size,
      sha256: artifactPackage.sha256,
      contentType: artifactPackage.contentType
    },
    fileManifest: parseItem.fileManifest || [],
    contentFingerprint: parseItem.contentFingerprint,
    sourceSnapshot: source,
    scan: parseItem.unscanned
      ? { status: 'unscanned', warnings: [], scannedAt: null }
      : { status: 'passed', warnings: parseItem.warnings || [], scannedAt: new Date() },
    createdBy: { badge: owner.badge, name: owner.name }
  };
  let versionDocument = await SkillVersion.findOne(packageFilter).lean();
  let created = false;
  if (!versionDocument) {
    // A stable package ID makes concurrent approvals and interrupted publishes idempotent.
    const versionId = crypto.createHash('sha256')
      .update(JSON.stringify([String(skill._id), artifactPackage.sha256, parseItem.sourcePath]))
      .digest('hex').slice(0, 24);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await Skill.findById(skill._id).select('status versionSequence lastAllocatedVersion currentVersion').lean();
      if (!current || current.status === 'deleted') throw new SkillVersionError('该 Skill 已删除', 409);
      if (current.status === 'pending_review') {
        throw new SkillVersionError('请先审批该 Skill 已发布过的版本', 409, 'SKILL_EXISTING_REVIEW_REQUIRED');
      }
      const previous = current.lastAllocatedVersion || (current.currentVersion === '0.0.0' ? null : current.currentVersion);
      const version = resolveVersion(parseItem.version, previous);
      const allocated = await Skill.findOneAndUpdate({
        _id: skill._id,
        status: canPublish,
        versionSequence: current.versionSequence ?? null
      }, { $inc: { versionSequence: 1 }, $set: { lastAllocatedVersion: version } }, { new: true, timestamps: false });
      if (!allocated) continue;
      try {
        versionDocument = await SkillVersion.create({
          ...versionData, _id: versionId, skillId: skill._id, revision: allocated.versionSequence, version
        });
        created = true;
        break;
      } catch (error) {
        if (error.code !== 11000) throw error;
        versionDocument = await SkillVersion.findOne(packageFilter).lean();
        if (versionDocument) break;
      }
    }
    if (!versionDocument) throw new SkillVersionError('Skill 版本正在发布，请重试', 409, 'SKILL_PUBLISH_CONFLICT');
  }

  // Legacy skills have a version pointer but do not have latestRevision yet.
  const current = skill.latestRevision == null && skill.latestVersionId
    ? await SkillVersion.findById(skill.latestVersionId).select('revision').lean()
    : null;
  if (versionDocument.revision > (skill.latestRevision ?? current?.revision ?? 0)) {
    const update = {
      manifestId: manifestId || skill.manifestId,
      name,
      normalizedName,
      summary: String(selection.summary || parseItem.summary || skill.summary || '').trim().slice(0, 1000),
      category,
      ...(selection.official ? { track: 'official' } : {}),
      tags: normalizeTags(selection.tags?.length ? selection.tags : parseItem.tags?.length ? parseItem.tags : skill.tags),
      latestVersionId: versionDocument._id,
      latestRevision: versionDocument.revision,
      currentVersion: versionDocument.version,
      source,
      status: 'published',
      security: versionData.scan,
      contentUpdatedAt: versionDocument.publishedAt
    };
    const fields = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, { $literal: value }]));
    const published = await Skill.findOneAndUpdate({
      _id: skill._id,
      status: canPublish,
      $or: [{ latestRevision: null }, { latestRevision: { $lt: versionDocument.revision } }]
    }, [{ $set: { ...fields, publishedAt: { $ifNull: ['$publishedAt', versionDocument.publishedAt] } } }], { new: true });
    if (published) skill = published;
  } else if (String(skill.latestVersionId) === String(versionDocument._id)) {
    // Reusing the current package can still apply the administrator's metadata choices.
    await Skill.updateOne({ _id: skill._id, latestVersionId: versionDocument._id, status: canPublish }, {
      $set: { category, ...(selection.official ? { track: 'official' } : {}) }
    });
  }
  return { skill, version: versionDocument, created, matchStrategy: manifestId ? 'manifestId' : 'nameOrContent' };
}

function userJobFilter(jobId, user) {
  const badge = String(user.Badge || user.badge || user.userId || '');
  return { jobId, 'operator.badge': badge, sourceType: 'zip' };
}

async function submitImportJob(jobId, selections, user) {
  const filter = userJobFilter(jobId, user);
  const job = await SkillImportJob.findOne(filter);
  if (!job) throw new SkillVersionError('导入任务不存在', 404, 'IMPORT_JOB_NOT_FOUND');
  if (job.status === 'succeeded') return job;
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > job.parseItems.length
      || selections.some(item => typeof item?.itemKey !== 'string' || !/^[a-f0-9]{20}$/.test(item.itemKey))) {
    throw new SkillVersionError('请选择本次解析的 Skill');
  }
  const uniqueSelections = [...new Map(selections.map(item => [item.itemKey, item])).values()];

  const now = new Date();
  const claimed = await SkillImportJob.findOneAndUpdate({
    ...filter,
    $or: [{ status: 'ready' }, { status: 'submitting', updatedAt: { $lt: new Date(now - PUBLISH_LOCK_MS) } }]
  }, { $set: { status: 'submitting', stage: 'submitting_for_review', progress: 90, lockedAt: now } });
  if (!claimed) throw new SkillVersionError('导入任务尚未就绪或正在提交', 409, 'IMPORT_JOB_NOT_READY');

  const results = [];
  for (const selection of uniqueSelections) {
    const parseItem = job.parseItems.find((item) => item.itemKey === selection.itemKey);
    if (!parseItem) {
      results.push({ itemKey: selection.itemKey, success: false, message: '解析条目不存在' });
      continue;
    }
    try {
      const reviewId = job.jobId + ':' + parseItem.itemKey;
      const name = String(selection.name || parseItem.name || '').trim().slice(0, 120);
      if (!name) throw new SkillVersionError('Skill 名称不能为空');
      if (!parseItem.package?.bucket || !parseItem.package?.objectKey || !parseItem.package?.sha256) {
        throw new SkillVersionError('Skill 独立制品不存在，请重新解析后提交');
      }
      await SkillSubmission.updateOne({ _id: reviewId }, { $setOnInsert: {
        operator: job.operator.toObject(),
        parseItem,
        selection: {
          name,
          summary: String(selection.summary || parseItem.summary || '').trim().slice(0, 1000),
          tags: normalizeTags(selection.tags?.length ? selection.tags : [...(parseItem.tags || []), ...(job.defaults?.tags || [])]),
          changeLog: String(selection.changeLog || '').trim().slice(0, 1000)
        },
        status: 'pending'
      } }, { upsert: true });
      results.push({ itemKey: selection.itemKey, success: true, reviewId, name });
    } catch (error) {
      results.push({ itemKey: selection.itemKey, success: false, message: error instanceof SkillVersionError ? error.message : '提交失败，请重试' });
    }
  }

  const succeeded = results.some((item) => item.success);
  const completed = await SkillImportJob.findOneAndUpdate({ ...filter, status: 'submitting', lockedAt: now }, {
    $set: {
      results, status: succeeded ? 'succeeded' : 'failed',
      stage: succeeded ? 'awaiting_review' : 'submit_failed',
      progress: 100, lockedAt: null,
      expiresAt: new Date(Date.now() + JOB_TTL_MS),
      error: succeeded ? { code: '', message: '' } : { code: 'ALL_ITEMS_FAILED', message: '所有 Skill 均提交失败' }
    }
  }, { new: true });
  if (!completed) throw new SkillVersionError('导入任务正在处理，请刷新任务状态', 409, 'IMPORT_JOB_NOT_READY');
  return completed;
}

module.exports = {
  CATEGORY_ALIASES,
  SkillVersionError,
  compareSemver,
  createOrUpgradeSkill,
  findMatchingSkill,
  nextPatchVersion,
  normalizeCategory,
  normalizeSkillName,
  requireCategory,
  resolveVersion,
  submitImportJob,
  userJobFilter,
  PUBLISH_LOCK_MS
};
