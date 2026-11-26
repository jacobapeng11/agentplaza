const mongoose = require('mongoose');
const Skill = require('../models/Skill');
const SkillVersion = require('../models/SkillVersion');
const SkillFavorite = require('../models/SkillFavorite');

const CATEGORY_OPTIONS = [
  { id: 'all', name: '全部' },
  { id: 'market', name: '大市场' },
  { id: 'finance', name: '财经类' },
  { id: 'office', name: '办公类' },
  { id: 'administration', name: '行政类' },
  { id: 'research', name: '研发类' },
  { id: 'general', name: '综合类' }
];
const SKILL_PROJECTION = {
  name: 1, summary: 1, category: 1, tags: 1, track: 1, visibility: 1,
  currentVersion: 1, owner: 1, source: 1, stats: 1, hotScore: 1, security: 1,
  publishedAt: 1, contentUpdatedAt: 1, updatedAt: 1
};

class SkillCatalogError extends Error {
  constructor(message, statusCode = 400, code = 'SKILL_CATALOG_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function userBadge(user) {
  return String(user.Badge || user.badge || user.userId || '');
}

function textSearchFilter(value) {
  const search = typeof value === 'string' ? value.trim().slice(0, 100) : '';
  return search ? { $text: { $search: search } } : {};
}

function mapSkill(skill, favoriteIds = new Set()) {
  return {
    id: String(skill._id),
    name: skill.name,
    summary: skill.summary,
    category: skill.category,
    tags: skill.tags || [],
    track: skill.track,
    visibility: skill.visibility,
    version: skill.currentVersion,
    owner: skill.owner,
    source: { type: skill.source?.type || 'zip' },
    stats: {
      viewCount: Number(skill.stats?.viewCount || 0),
      viewerCount: Number(skill.stats?.viewerCount || 0),
      downloadCount: Number(skill.stats?.downloadCount || 0),
      favoriteCount: Number(skill.stats?.favoriteCount || 0),
      ratingAverage: Number(skill.stats?.ratingAverage || 0),
      ratingCount: Number(skill.stats?.ratingCount || 0)
    },
    hotScore: skill.hotScore || 0,
    security: skill.security,
    isFavorite: favoriteIds.has(String(skill._id)),
    publishedAt: skill.publishedAt,
    contentUpdatedAt: skill.contentUpdatedAt || skill.publishedAt || skill.updatedAt,
    updatedAt: skill.updatedAt
  };
}

async function listSkills(query, user) {
  const page = Math.min(100000, Math.max(1, parseInt(query.page, 10) || 1));
  const limit = Math.min(60, Math.max(1, parseInt(query.limit, 10) || 24));
  const category = String(query.category || 'all');
  const filter = { status: 'published', visibility: 'organization', ...textSearchFilter(query.search) };
  if (category !== 'all' && CATEGORY_OPTIONS.some((item) => item.id === category)) filter.category = category;
  if (query.track === 'official' || query.track === 'community') filter.track = query.track;

  const badge = userBadge(user);
  if (String(query.favoriteOnly) === 'true') {
    const favoriteRows = await SkillFavorite.find({ userBadge: badge }).select('skillId').lean();
    filter._id = { $in: favoriteRows.map((row) => row.skillId) };
  }
  if (query.ownerOnly === 'true') filter['owner.badge'] = badge;
  const sortMap = {
    latest: { contentUpdatedAt: -1, _id: -1 },
    downloads: { 'stats.downloadCount': -1, contentUpdatedAt: -1 },
    favorites: { 'stats.favoriteCount': -1, contentUpdatedAt: -1 },
    hot: { hotScore: -1, contentUpdatedAt: -1 }
  };
  const sort = filter.$text ? { score: { $meta: 'textScore' }, hotScore: -1 }
    : (Object.hasOwn(sortMap, query.sort) ? sortMap[query.sort] : sortMap.hot);
  const projection = filter.$text ? { ...SKILL_PROJECTION, score: { $meta: 'textScore' } } : SKILL_PROJECTION;
  const [rows, total] = await Promise.all([
    Skill.find(filter)
      .select(projection)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Skill.countDocuments(filter)
  ]);
  const favorites = rows.length
    ? await SkillFavorite.find({ userBadge: badge, skillId: { $in: rows.map((item) => item._id) } }).select('skillId').lean()
    : [];
  const favoriteIds = new Set(favorites.map((item) => String(item.skillId)));
  return { items: rows.map((row) => mapSkill(row, favoriteIds)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

function assertObjectId(id) {
  if (!mongoose.isValidObjectId(id)) throw new SkillCatalogError('Skill 不存在', 404, 'SKILL_NOT_FOUND');
}

function buildDownloadFileName(name, version) {
  const safeName = String(name || 'skill')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'skill';
  const safeVersion = String(version || '1.0.0').replace(/[^0-9A-Za-z._-]/g, '_');
  return `${safeName}-v${safeVersion}.zip`;
}

async function getSkillDetail(id, user) {
  assertObjectId(id);
  const skill = await Skill.findOne({ _id: id, status: 'published', visibility: 'organization' }).lean();
  if (!skill) throw new SkillCatalogError('Skill 不存在或已下架', 404, 'SKILL_NOT_FOUND');
  const [version, favorite] = await Promise.all([
    skill.latestVersionId ? SkillVersion.findById(skill.latestVersionId).select('-package').lean() : null,
    SkillFavorite.exists({ skillId: skill._id, userBadge: userBadge(user) })
  ]);
  return { ...mapSkill(skill, favorite ? new Set([String(skill._id)]) : new Set()), latestVersion: version };
}

async function listSkillVersions(id) {
  assertObjectId(id);
  const skill = await Skill.findOne({ _id: id, status: 'published', visibility: 'organization' }).select('latestVersionId latestRevision').lean();
  if (!skill) throw new SkillCatalogError('Skill 不存在或已下架', 404, 'SKILL_NOT_FOUND');
  const latestRevision = skill.latestRevision ?? (skill.latestVersionId
    ? (await SkillVersion.findById(skill.latestVersionId).select('revision').lean())?.revision
    : undefined);
  const rows = await SkillVersion.find({
    skillId: id, status: 'published',
    ...(latestRevision != null ? { revision: { $lte: latestRevision } } : {})
  })
    .select('version revision sourcePath changeLog scan createdBy publishedAt createdAt')
    .sort({ revision: -1 })
    .lean();
  return rows.map((row) => ({ ...row, id: String(row._id), _id: undefined }));
}

async function toggleSkillFavorite(id, user) {
  assertObjectId(id);
  const skill = await Skill.findOne({ _id: id, status: 'published', visibility: 'organization' }).select('_id stats').lean();
  if (!skill) throw new SkillCatalogError('Skill 不存在或已下架', 404, 'SKILL_NOT_FOUND');
  const badge = userBadge(user);
  const existing = await SkillFavorite.findOne({ skillId: id, userBadge: badge }).select('_id').lean();
  let isFavorite;
  if (existing) {
    await SkillFavorite.deleteOne({ _id: existing._id });
    await Skill.updateOne({ _id: id }, { $inc: { 'stats.favoriteCount': -1, hotScore: -2 } }, { timestamps: false });
    isFavorite = false;
  } else {
    await SkillFavorite.create({ skillId: id, userBadge: badge, userName: String(user.Name || user.name || '') });
    await Skill.updateOne({ _id: id }, { $inc: { 'stats.favoriteCount': 1, hotScore: 2 } }, { timestamps: false });
    isFavorite = true;
  }
  const updated = await Skill.findById(id).select('stats.favoriteCount').lean();
  return { id, isFavorite, favoriteCount: Math.max(0, Number(updated?.stats?.favoriteCount || 0)) };
}

async function setSkillOfficial(id, official) {
  assertObjectId(id);
  const track = official ? 'official' : 'community';
  const skill = await Skill.findOneAndUpdate(
    { _id: id, status: { $in: ['published', 'offline'] }, visibility: 'organization' },
    { $set: { track } },
    { new: true }
  ).select('_id track').lean();
  if (!skill) throw new SkillCatalogError('Skill 不存在或已下架', 404, 'SKILL_NOT_FOUND');
  return { id: String(skill._id), track: skill.track };
}

async function createSkillDownload(id) {
  assertObjectId(id);
  const skill = await Skill.findOne({ _id: id, status: 'published', visibility: 'organization' }).select('name latestVersionId').lean();
  if (!skill?.latestVersionId) throw new SkillCatalogError('Skill 暂无可下载版本', 404, 'SKILL_VERSION_NOT_FOUND');
  const version = await SkillVersion.findById(skill.latestVersionId).select('version package').lean();
  const archive = version?.package;
  if (!archive?.bucket || !archive.objectKey) throw new SkillCatalogError('Skill 制品不存在', 404, 'SKILL_PACKAGE_NOT_FOUND');
  return {
    archive,
    fileName: buildDownloadFileName(skill.name, version.version),
    version: version.version
  };
}

module.exports = {
  CATEGORY_OPTIONS,
  SKILL_PROJECTION,
  SkillCatalogError,
  assertObjectId,
  buildDownloadFileName,
  createSkillDownload,
  getSkillDetail,
  listSkillVersions,
  listSkills,
  mapSkill,
  setSkillOfficial,
  textSearchFilter,
  toggleSkillFavorite
};
