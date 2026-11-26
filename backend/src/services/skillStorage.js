const fs = require('node:fs');
const { Transform, addAbortSignal } = require('node:stream');
const { GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const storageTimeoutMs = 120000;
const skillObjectKey = /^skills\/(?:imports|artifacts)\/[a-z0-9_-]+\/[a-z0-9_-]+\.zip$/;
let storage;

class SkillStorageError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'SkillStorageError';
    this.statusCode = statusCode;
    this.code = 'SKILL_STORAGE_ERROR';
  }
}

function getSkillStorage() {
  if (storage) return storage;

  const bucket = process.env.SKILL_OSS_BUCKET?.trim();
  if (!bucket) throw new Error('SKILL_OSS_BUCKET is required for the Skill marketplace');

  const endpoint = process.env.SKILL_OSS_ENDPOINT?.trim();
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
          || url.pathname !== '/' || url.search || url.hash) throw new Error();
    } catch {
      throw new Error('SKILL_OSS_ENDPOINT must be an HTTP or HTTPS origin');
    }
  }

  const accessKeyId = process.env.SKILL_OSS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SKILL_OSS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.SKILL_OSS_SESSION_TOKEN;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey) || (sessionToken && !accessKeyId)) {
    throw new Error('Set both SKILL_OSS_ACCESS_KEY_ID and SKILL_OSS_SECRET_ACCESS_KEY for a static S3 credential');
  }
  const forcePathStyle = process.env.SKILL_OSS_FORCE_PATH_STYLE;
  if (forcePathStyle && !['true', 'false'].includes(forcePathStyle)) {
    throw new Error('SKILL_OSS_FORCE_PATH_STYLE must be true or false');
  }

  storage = {
    bucket,
    client: new S3Client({
      ...(endpoint ? { endpoint } : {}),
      region: process.env.SKILL_OSS_REGION?.trim() || 'us-east-1',
      forcePathStyle: forcePathStyle ? forcePathStyle === 'true' : Boolean(endpoint),
      ...(accessKeyId ? { credentials: { accessKeyId, secretAccessKey, sessionToken } } : {}),
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    })
  };

  return storage;
}

async function uploadSkillObject(file, objectKey) {
  const { bucket, client } = getSkillStorage();
  if (!skillObjectKey.test(objectKey)) throw new SkillStorageError('无效的 Skill 制品路径');
  const body = file.buffer || fs.createReadStream(file.path);
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentLength: file.size,
      ContentType: 'application/zip'
    }), { abortSignal: AbortSignal.timeout(storageTimeoutMs) });
  } catch {
    throw new SkillStorageError('未能保存 Skill ZIP');
  } finally {
    if (!file.buffer) body.destroy();
  }

  return { bucket, objectKey, originalName: file.originalName, size: file.size, contentType: 'application/zip' };
}

async function openSkillObject(archive, { kind, maxBytes }) {
  const { bucket, client } = getSkillStorage();
  const objectKey = archive?.objectKey;
  if (archive?.bucket !== bucket || !skillObjectKey.test(objectKey) || !objectKey.startsWith('skills/' + kind + '/')) {
    throw new SkillStorageError('未找到 Skill ZIP', 404);
  }

  const signal = AbortSignal.timeout(storageTimeoutMs);
  let response;
  try {
    response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }), { abortSignal: signal });
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404) throw new SkillStorageError('未找到 Skill ZIP', 404);
    throw new SkillStorageError('未能读取 Skill ZIP');
  }

  const stream = response.Body;
  if (!stream) throw new SkillStorageError('Skill ZIP 缺少内容');
  const length = response.ContentLength;
  if (typeof length === 'number' && length > maxBytes) {
    stream.destroy();
    throw new SkillStorageError('Skill ZIP 超过允许大小', 413);
  }
  return { stream: addAbortSignal(signal, stream), length };
}

function limitSkillBytes(maxBytes) {
  let size = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) return callback(new SkillStorageError('Skill ZIP 超过允许大小', 413));
      callback(null, chunk);
    }
  });
}

module.exports = { getSkillStorage, limitSkillBytes, openSkillObject, uploadSkillObject };
