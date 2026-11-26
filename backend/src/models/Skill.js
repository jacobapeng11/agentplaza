const mongoose = require('mongoose');

const SKILL_CATEGORIES = ['market', 'finance', 'office', 'administration', 'research', 'general'];
const SKILL_SOURCE_TYPES = ['zip', 'builtin'];

const ownerSchema = new mongoose.Schema({
  badge: { type: String, required: true, trim: true },
  name: { type: String, default: '', trim: true },
  departmentCode: { type: String, default: '', trim: true }
}, { _id: false });

const sourceSchema = new mongoose.Schema({
  type: { type: String, enum: SKILL_SOURCE_TYPES, required: true }
}, { _id: false });

const skillSchema = new mongoose.Schema({
  identityKey: { type: String, required: true, unique: true, index: true },
  manifestId: { type: String, default: null, index: true },
  slug: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  normalizedName: { type: String, required: true, index: true },
  summary: { type: String, default: '', maxlength: 1000 },
  category: { type: String, enum: SKILL_CATEGORIES, default: 'general', index: true },
  tags: { type: [String], default: [] },
  track: { type: String, enum: ['official', 'community'], default: 'community', index: true },
  visibility: { type: String, enum: ['organization', 'private'], default: 'organization' },
  status: { type: String, enum: ['processing', 'published', 'offline', 'pending_review', 'review_rejected', 'deleted'], default: 'processing', index: true },
  publicationReview: {
    queuedAt: Date,
    reviewedAt: Date,
    reviewedBy: String
  },
  latestVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SkillVersion', default: null },
  latestRevision: { type: Number },
  currentVersion: { type: String, default: '1.0.0' },
  versionSequence: { type: Number, default: 0 },
  lastAllocatedVersion: { type: String },
  owner: { type: ownerSchema, required: true },
  source: { type: sourceSchema, required: true },
  stats: {
    viewCount: { type: Number, default: 0, min: 0 },
    viewerCount: { type: Number, default: 0, min: 0 },
    downloadCount: { type: Number, default: 0, min: 0 },
    favoriteCount: { type: Number, default: 0, min: 0 },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 }
  },
  hotScore: { type: Number, default: 0, index: true },
  security: {
    status: { type: String, enum: ['pending', 'passed', 'failed', 'unscanned'], default: 'pending' },
    scannedAt: { type: Date, default: null },
    warnings: { type: [String], default: [] }
  },
  derivedStatsUpdatedAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  contentUpdatedAt: { type: Date, default: null, index: true },
  deletedAt: { type: Date, default: null }
}, { timestamps: true, collection: 'skills' });

skillSchema.index({ status: 1, category: 1, hotScore: -1, contentUpdatedAt: -1 });
skillSchema.index({ 'owner.badge': 1, createdAt: -1 });
skillSchema.index(
  { name: 'text', summary: 'text', tags: 'text', 'owner.name': 'text', 'owner.badge': 'text' },
  {
    name: 'skill_search_text',
    default_language: 'none',
    weights: { name: 8, tags: 4, 'owner.name': 3, 'owner.badge': 3, summary: 2 }
  }
);

skillSchema.set('toJSON', { virtuals: true });

const Skill = mongoose.models.Skill || mongoose.model('Skill', skillSchema);

module.exports = Skill;
module.exports.SKILL_CATEGORIES = SKILL_CATEGORIES;
module.exports.SKILL_SOURCE_TYPES = SKILL_SOURCE_TYPES;
