const Skill = require('../models/Skill');
const SkillSubmission = require('../models/SkillSubmission');
const SkillVersion = require('../models/SkillVersion');
const { assertObjectId, mapSkill, SkillCatalogError, SKILL_PROJECTION, textSearchFilter } = require('./skillCatalogService');
const { createOrUpgradeSkill, requireCategory, PUBLISH_LOCK_MS } = require('./skillVersionService');
const logger = require('../utils/logger');

const EXISTING_SKILL_PREFIX = 'catalog:';
const MAX_BATCH_SIZE = 200;
function managedSourceFilter(source) {
  if (source === 'all') return {};
  if (!Skill.SKILL_SOURCE_TYPES.includes(source)) {
    throw new SkillCatalogError('无效的 Skill 来源', 400, 'INVALID_SKILL_SOURCE');
  }
  return { 'source.type': source };
}

function mapSubmission(row) {
  return {
    id: row._id,
    name: row.selection.name,
    summary: row.selection.summary,
    tags: row.selection.tags,
    owner: row.operator,
    source: { type: 'zip' },
    version: row.parseItem?.version,
    status: row.status,
    submittedAt: row.createdAt
  };
}

async function getSubmissionArchive(id) {
  const row = await SkillSubmission.findById(id).select('parseItem.package').lean();
  const archive = row?.parseItem?.package;

  if (!archive?.bucket || !archive.objectKey) throw new SkillCatalogError('未找到原始 ZIP', 404, 'SKILL_PACKAGE_NOT_FOUND');
  return { archive, fileName: archive.originalName || 'source.zip' };
}

async function listManagedSkills(query) {
  const page = Math.max(1, Math.min(100000, parseInt(query.page, 10) || 1));
  const limit = Math.max(1, Math.min(60, parseInt(query.limit, 10) || 20));
  const search = textSearchFilter(query.search);
  const sourceFilter = managedSourceFilter(query.source ?? 'all');
  if (!['published', 'offline'].includes(query.status)) return listPendingSkills(search, sourceFilter, page, limit);

  const filter = { status: query.status, visibility: 'organization', ...search, ...sourceFilter };
  const projection = { ...SKILL_PROJECTION, status: 1 };
  const sort = { contentUpdatedAt: -1, _id: -1 };
  if (search.$text) {
    projection.score = { $meta: 'textScore' };
  }
  const [rows, total] = await Promise.all([
    Skill.find(filter)
      .select(projection)
      .sort(search.$text ? { score: { $meta: 'textScore' }, hotScore: -1, ...sort } : sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Skill.countDocuments(filter)
  ]);
  return {
    items: rows.map((row) => ({ ...mapSkill(row), status: row.status })),
    pagination: { page, limit, total }
  };
}

async function listPendingSkills(search, sourceFilter, page, limit) {
  const score = search.$text ? { score: { $meta: 'textScore' } } : {};
  const sort = { submittedAt: -1, ...(search.$text ? { score: -1 } : {}), id: 1 };
  const [result] = await SkillSubmission.aggregate([
    { $match: { status: { $in: ['pending', 'publishing'] }, ...search } },
    { $project: {
      _id: 0, id: '$_id', name: '$selection.name', summary: '$selection.summary', tags: '$selection.tags',
      owner: '$operator', source: { $literal: { type: 'zip' } },
      version: '$parseItem.version', status: 1, submittedAt: '$createdAt', ...score
    } },
    { $unionWith: {
      coll: Skill.collection.name,
      pipeline: [
        { $match: { status: 'pending_review', ...search } },
        { $project: {
          _id: 0, id: { $concat: [EXISTING_SKILL_PREFIX, { $toString: '$_id' }] },
          name: 1, summary: 1, tags: 1, owner: 1, source: 1, version: '$currentVersion',
          status: { $literal: 'pending' }, submittedAt: '$publicationReview.queuedAt', ...score
        } }
      ]
    } },
    { $match: sourceFilter },
    { $facet: {
      items: [{ $sort: sort }, { $skip: (page - 1) * limit }, { $limit: limit }, { $project: { score: 0 } }],
      count: [{ $count: 'total' }]
    } }
  ]);
  return { items: result.items.map(labelManagedSource), pagination: { page, limit, total: result.count[0]?.total || 0 } };
}

async function getSkillSubmission(id) {
  if (id.startsWith(EXISTING_SKILL_PREFIX)) {
    const skillId = id.slice(EXISTING_SKILL_PREFIX.length);
    assertObjectId(skillId);
    const skill = await Skill.findOne({ _id: skillId, status: 'pending_review' })
      .select('name summary tags owner source category track currentVersion latestVersionId publicationReview.queuedAt')
      .lean();
    if (!skill) throw new SkillCatalogError('Skill 审批记录不存在', 404, 'SKILL_SUBMISSION_NOT_FOUND');
    const version = skill.latestVersionId
      ? await SkillVersion.findById(skill.latestVersionId).select('sourcePath skillMdContent fileManifest scan.warnings').lean()
      : null;
    return {
      id,
      name: skill.name,
      summary: skill.summary,
      tags: skill.tags || [],
      owner: skill.owner,
      source: skill.source,
      category: skill.category,
      track: skill.track,
      version: skill.currentVersion,
      status: 'pending',
      submittedAt: skill.publicationReview?.queuedAt,
      sourcePath: version?.sourcePath || 'SKILL.md',
      skillMdContent: version?.skillMdContent || '',
      fileManifest: version?.fileManifest || [],
      warnings: version?.scan?.warnings || []
    };
  }
  const row = await SkillSubmission.findById(id).lean();
  if (!row) throw new SkillCatalogError('Skill 审批记录不存在', 404, 'SKILL_SUBMISSION_NOT_FOUND');
  return {
    ...mapSubmission(row),
    ...(row.parseItem.package?.objectKey ? { archiveName: row.parseItem.package?.originalName || 'source.zip' } : {}),
    sourcePath: row.parseItem.sourcePath,
    skillMdContent: row.parseItem.skillMdContent,
    fileManifest: row.parseItem.fileManifest || [],
    warnings: row.parseItem.warnings || []
  };
}

function unavailableSubmission() {
  return new SkillCatalogError('该提交已处理或正在审批，请刷新列表', 409, 'SKILL_REVIEW_CONFLICT');
}

function validateReview({ decision, category, official }, allowPreservingTrack) {
  if (decision === 'reject') return;
  if (decision !== 'approve' || (typeof official !== 'boolean' && !(allowPreservingTrack && official === undefined))) {
    throw new SkillCatalogError('请选择审批结果和官方精选状态', 400, 'INVALID_SKILL_REVIEW');
  }
  requireCategory(category);
}

async function reviewSkillSubmission(id, { decision, category, official }, admin, { allowPreservingTrack = false } = {}) {
  validateReview({ decision, category, official }, allowPreservingTrack);
  const reviewedBy = String(admin.Badge || admin.badge);
  const now = new Date();
  if (id.startsWith(EXISTING_SKILL_PREFIX)) {
    const skillId = id.slice(EXISTING_SKILL_PREFIX.length);
    assertObjectId(skillId);
    const changes = decision === 'approve'
      ? { status: 'published', category, ...(official === undefined ? {} : { track: official ? 'official' : 'community' }) }
      : { status: 'review_rejected' };
    const skill = await Skill.findOneAndUpdate({ _id: skillId, status: 'pending_review' }, {
      $set: { ...changes, 'publicationReview.reviewedAt': now, 'publicationReview.reviewedBy': reviewedBy }
    }).select('_id').lean();
    if (!skill) throw unavailableSubmission();
    return { id, status: decision === 'approve' ? 'approved' : 'rejected', skillId };
  }
  if (decision === 'reject') {
    const rejected = await SkillSubmission.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: { status: 'rejected', reviewedAt: now, reviewedBy } }
    );
    if (!rejected) throw unavailableSubmission();
    return { id, status: 'rejected' };
  }
  const row = await SkillSubmission.findOneAndUpdate({
    _id: id,
    $or: [{ status: 'pending' }, { status: 'publishing', reviewStartedAt: { $lt: new Date(now - PUBLISH_LOCK_MS) } }]
  }, { $set: { status: 'publishing', reviewStartedAt: now } }, { new: true }).lean();
  if (!row) throw unavailableSubmission();
  const claim = { _id: id, status: 'publishing', reviewStartedAt: now };
  let skill;
  try {
    ({ skill } = await createOrUpgradeSkill({
      parseItem: row.parseItem,
      selection: { ...row.selection, category, official },
      user: row.operator
    }));
  } catch (error) {
    await SkillSubmission.updateOne(claim, { $set: { status: 'pending' }, $unset: { reviewStartedAt: 1 } });
    throw error;
  }
  await SkillSubmission.updateOne(claim, {
    $set: { status: 'approved', reviewedAt: new Date(), reviewedBy, skillId: skill._id },
    $unset: { reviewStartedAt: 1 }
  });
  return { id, status: 'approved', skillId: String(skill._id) };
}

async function setManagedSkillCategory(id, category) {
  assertObjectId(id);
  requireCategory(category);
  const skill = await Skill.findOneAndUpdate(
    { _id: id, status: { $in: ['published', 'offline'] }, visibility: 'organization' },
    { $set: { category } },
    { new: true }
  ).lean();
  if (!skill) throw new SkillCatalogError('Skill 不存在', 404, 'SKILL_NOT_FOUND');
  return { id, category: skill.category };
}

async function runManagedBatch(ids, action) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BATCH_SIZE ||
      ids.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new SkillCatalogError(`请选择 1 至 ${MAX_BATCH_SIZE} 个 Skill`, 400, 'INVALID_SKILL_BATCH');
  }
  const results = [];
  // Apply the same status guards as single-item actions, and keep each result independently retryable.
  for (const id of new Set(ids)) {
    try {
      await action(id);
      results.push({ id, success: true });
    } catch (error) {
      const known = error.statusCode >= 400 && error.statusCode < 500;
      if (!known) logger.error('[skills] batch operation failed:', error.message);
      results.push({ id, success: false, message: known ? error.message : '操作失败，请稍后重试' });
    }
  }
  return { results };
}

function reviewSkillSubmissions({ ids, decision, category, official }, admin) {
  const review = { decision, category, official };
  validateReview(review, true);
  return runManagedBatch(ids, (id) => reviewSkillSubmission(id, review, admin, { allowPreservingTrack: true }));
}

function setManagedSkillCategories({ ids, category }) {
  requireCategory(category);
  return runManagedBatch(ids, (id) => setManagedSkillCategory(id, category));
}

async function setManagedSkillStatus(id, status) {
  assertObjectId(id);
  if (!['offline', 'published'].includes(status)) {
    throw new SkillCatalogError('Skill 状态无效', 400, 'INVALID_SKILL_STATUS');
  }
  const previous = status === 'offline' ? 'published' : 'offline';
  const skill = await Skill.findOneAndUpdate(
    { _id: id, status: previous, visibility: 'organization', latestVersionId: { $ne: null } },
    { $set: { status } },
    { new: true }
  ).lean();
  if (!skill) throw new SkillCatalogError('Skill 状态已变更，请刷新列表', 409, 'SKILL_STATUS_CONFLICT');
  return { id, status: skill.status };
}

module.exports = {
  getSkillSubmission, getSubmissionArchive, listManagedSkills,
  reviewSkillSubmission, reviewSkillSubmissions, setManagedSkillCategory, setManagedSkillCategories, setManagedSkillStatus
};
