const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const { pipeline } = require('stream/promises');
const { getUserInfoFromToken } = require('../utils/auth');
const { resolveAdminBadges } = require('../config/adminBadges');
const { limitSkillBytes, openSkillObject, uploadSkillObject } = require('../services/skillStorage');
const { MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES } = require('../services/skillArchiveParser');
const { createImportJob } = require('../services/skillImportQueueService');
const { submitImportJob, userJobFilter } = require('../services/skillVersionService');
const { CATEGORY_OPTIONS, createSkillDownload, getSkillDetail, listSkills, listSkillVersions, setSkillOfficial, toggleSkillFavorite } = require('../services/skillCatalogService');
const {
  getSkillSubmission, getSubmissionArchive, listManagedSkills,
  reviewSkillSubmission, reviewSkillSubmissions, setManagedSkillCategory, setManagedSkillCategories, setManagedSkillStatus
} = require('../services/skillModerationService');
const { skillOverview } = require('../services/skillOverviewService');
const { recordSkillDownload, recordSkillView } = require('../services/skillStatsService');
const SkillImportJob = require('../models/SkillImportJob');
const logger = require('../utils/logger');

const router = express.Router();
const maxArtifactBytes = MAX_EXPANDED_BYTES * 2;
const uploadDirectory = path.join(os.tmpdir(), 'agentplaza-skill-uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDirectory),
    filename: (_req, _file, callback) => callback(null, randomUUID() + '.zip')
  }),
  limits: { fileSize: MAX_ARCHIVE_BYTES, files: 1, fields: 3, fieldSize: 4096 },
  fileFilter: (_req, file, callback) => {
    const zipName = String(file.originalname || '').toLowerCase().endsWith('.zip');
    const zipMime = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.mimetype);
    if (!zipName || !zipMime) {
      return callback(Object.assign(new Error('仅支持 ZIP 格式的 Skill 包'), { statusCode: 400 }));
    }
    callback(null, true);
  }
});

function sendSuccess(res, data, message = 'OK') {
  return res.status(200).json({ code: 200, success: true, data, message });
}

function sendError(res, error) {
  const statusCode = error.statusCode || (error instanceof multer.MulterError ? 400 : 500);
  return res.status(statusCode).json({
    code: statusCode,
    success: false,
    message: statusCode < 500 ? error.message : 'Skill 服务暂不可用',
    errorCode: statusCode < 500 ? error.code || 'SKILL_REQUEST_ERROR' : 'SKILL_INTERNAL_ERROR'
  });
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.authtoken;
  if (!authHeader) return res.status(401).json({ code: 401, success: false, message: 'Authentication required' });
  try {
    const user = await getUserInfoFromToken(authHeader);
    if (!user) return res.status(401).json({ code: 401, success: false, message: 'Invalid authentication token' });
    req.user = user;
    next();
  } catch (error) {
    return sendError(res, Object.assign(error, { statusCode: 401 }));
  }
}

function isSkillAdmin(user) {
  return resolveAdminBadges().includes(user?.Badge);
}

function skillAdminMiddleware(req, res, next) {
  if (!isSkillAdmin(req.user)) {
    return res.status(403).json({ code: 403, success: false, message: '权限不足，仅管理员可管理 Skill', errorCode: 'SKILL_ADMIN_REQUIRED' });
  }
  return next();
}

function parseTags(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function buildContentDisposition(fileName) {
  const name = String(fileName || 'skill.zip').toWellFormed();
  const asciiName = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

function streamZipDownload(resolveDownload, { countDownloads = false } = {}) {
  return async (req, res) => {
    try {
      const download = await resolveDownload(req.params.id);
      const { stream, length } = await openSkillObject(download.archive, { kind: 'artifacts', maxBytes: maxArtifactBytes });
      res.status(200);
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', buildContentDisposition(download.fileName));
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      if (length !== undefined) res.set('Content-Length', String(length));
      await pipeline(stream, limitSkillBytes(maxArtifactBytes), res);
      if (countDownloads) {
        void recordSkillDownload(req.params.id).catch(error => logger.warn('Unable to record Skill download:', error.name));
      }
    } catch (error) {
      if (res.headersSent) {
        logger.warn('Skill download interrupted:', error.name);
        return res.destroy();
      }
      return sendError(res, error);
    }
  };
}

function mapJob(job, includeParseItems = true) {
  return {
    jobId: job.jobId,
    sourceType: job.sourceType,
    status: job.status,
    progress: job.progress,
    downloadedBytes: job.downloadedBytes,
    stage: job.stage,
    parseItems: includeParseItems ? (job.parseItems || []).map((item) => ({
      itemKey: item.itemKey,
      sourcePath: item.sourcePath,
      name: item.name,
      summary: item.summary,
      manifestId: item.manifestId,
      version: item.version,
      category: item.category,
      tags: item.tags,
      fileCount: item.fileCount,
      expandedSize: item.expandedSize,
      warnings: item.warnings
    })) : [],
    skippedItems: includeParseItems ? (job.skippedItems || []) : [],
    results: job.results || [],
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

router.use(authMiddleware);

router.get('/categories', (_req, res) => sendSuccess(res, { items: CATEGORY_OPTIONS }));

router.get('/overview', (_req, res, next) => {
  try {
    const status = skillOverview.status();
    if (status.updatedAt) {
      res.set('X-Skill-Stats-Updated-At', new Date(status.updatedAt).toISOString());
      res.set('X-Skill-Stats-Stale', String(status.stale));
    }
    return sendSuccess(res, skillOverview.get());
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res) => {
  try {
    return sendSuccess(res, await listSkills(req.query, req.user));
  } catch (error) {
    logger.error('[skills] list failed:', error.message);
    return sendError(res, error);
  }
});

const adminRouter = express.Router();
router.use('/admin', skillAdminMiddleware, adminRouter);

function adminAction(action, { refresh = false, message } = {}) {
  return async (req, res) => {
    try {
      const result = await action(req);
      if (refresh) await skillOverview.refresh().catch((error) => logger.error('[skills] overview refresh failed:', error.message));
      return sendSuccess(res, result, message);
    } catch (error) {
      return sendError(res, error);
    }
  };
}

adminRouter.get('/', adminAction((req) => listManagedSkills(req.query)));
adminRouter.get('/submissions/:id', adminAction((req) => getSkillSubmission(req.params.id)));
adminRouter.get('/submissions/:id/download', streamZipDownload(getSubmissionArchive));
adminRouter.put('/submissions/batch-review', adminAction(
  (req) => reviewSkillSubmissions(req.body || {}, req.user), { refresh: true }
));
adminRouter.put('/submissions/:id/review', adminAction(
  (req) => reviewSkillSubmission(req.params.id, req.body || {}, req.user), { refresh: true }
));
adminRouter.put('/batch/category', adminAction(
  (req) => setManagedSkillCategories(req.body || {}), { refresh: true }
));
adminRouter.put('/:id/category', adminAction(
  (req) => setManagedSkillCategory(req.params.id, req.body?.category), { refresh: true, message: '分类已更新' }
));
adminRouter.put('/:id/status', adminAction(
  (req) => setManagedSkillStatus(req.params.id, req.body?.status), { refresh: true }
));

router.post('/submissions/upload', (_req, res) => {
  return sendError(res, Object.assign(new Error('个人上传流程已更新，请刷新页面后上传并解析 ZIP'), {
    statusCode: 409, code: 'SKILL_PARSE_REQUIRED'
  }));
});

function acceptZipUpload(req, res, next) {
  upload.single('file')(req, res, error => error ? sendError(res, error) : next());
}

router.post('/import/upload', acceptZipUpload, async (req, res) => {
  const tempPath = req.file?.path;
  try {
    if (!req.file) throw Object.assign(new Error('请选择 Skill ZIP 文件'), { statusCode: 400 });
    const packageInfo = await uploadSkillObject({
      path: tempPath,
      size: req.file.size,
      originalName: String(req.file.originalname).slice(0, 128)
    }, 'skills/imports/' + randomUUID() + '/source.zip');
    const job = await createImportJob({
      user: req.user,
      packageInfo,
      tags: parseTags(req.body.tags).filter(tag => typeof tag === 'string').map(tag => tag.slice(0, 80)).slice(0, 10)
    });
    return sendSuccess(res, mapJob(job, false), 'Skill 已上传，等待独立解析服务处理');
  } catch (error) {
    return sendError(res, error);
  } finally {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
  }
});

router.get('/import/jobs/:jobId', async (req, res) => {
  try {
    const job = await SkillImportJob.findOne(userJobFilter(req.params.jobId, req.user));
    if (!job) throw Object.assign(new Error('导入任务不存在'), { statusCode: 404, code: 'IMPORT_JOB_NOT_FOUND' });
    return sendSuccess(res, mapJob(job));
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/import/jobs/:jobId/submit', async (req, res) => {
  try {
    const job = await submitImportJob(req.params.jobId, req.body?.selections, req.user);
    const message = job.status === 'failed' ? job.error.message : 'Skill 已提交审核';
    return sendSuccess(res, mapJob(job), message);
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/:id/versions', async (req, res) => {
  try {
    return sendSuccess(res, { items: await listSkillVersions(req.params.id) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:id/favorite', async (req, res) => {
  try {
    return sendSuccess(res, await toggleSkillFavorite(req.params.id, req.user));
  } catch (error) {
    return sendError(res, error);
  }
});

router.put('/:id/official', skillAdminMiddleware, async (req, res) => {
  try {
    if (typeof req.body?.official !== 'boolean') {
      throw Object.assign(new Error('official 必须为布尔值'), { statusCode: 400, code: 'INVALID_OFFICIAL_STATUS' });
    }
    const result = await setSkillOfficial(req.params.id, req.body.official);
    await skillOverview.refresh().catch(() => {});
    return sendSuccess(res, result, result.track === 'official' ? '已设为官方精选' : '已取消官方精选');
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/:id/download', streamZipDownload(createSkillDownload, { countDownloads: true }));

router.get('/:id', async (req, res) => {
  try {
    const detail = await getSkillDetail(req.params.id, req.user);
    recordSkillView(req.params.id, req.user).catch((error) => logger.error('[skills] record view failed:', error));
    return sendSuccess(res, detail);
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
module.exports.buildContentDisposition = buildContentDisposition;
module.exports.mapJob = mapJob;
