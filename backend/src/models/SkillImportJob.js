const mongoose = require('mongoose');

const skillImportJobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true, index: true },
  operator: {
    badge: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    departmentCode: { type: String, default: '' }
  },
  sourceType: { type: String, enum: ['zip'], required: true },
  package: {
    bucket: { type: String, default: '' },
    objectKey: { type: String, default: '' },
    originalName: { type: String, default: '' },
    size: { type: Number, default: 0 },
    sha256: { type: String, default: '' },
    contentType: { type: String, default: 'application/zip' }
  },
  defaults: {
    category: { type: String, default: 'general' },
    tags: { type: [String], default: [] },
    track: { type: String, enum: ['official', 'community'], default: 'community' }
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'ready', 'submitting', 'succeeded', 'failed'],
    default: 'queued',
    index: true
  },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  downloadedBytes: { type: Number, default: 0 },
  stage: { type: String, default: 'queued' },
  parseItems: { type: [mongoose.Schema.Types.Mixed], default: [] },
  skippedItems: { type: [{ _id: false, sourcePath: String, reason: String }], default: [] },
  results: { type: [mongoose.Schema.Types.Mixed], default: [] },
  attempts: { type: Number, default: 0 },
  nextRunAt: { type: Date, default: Date.now, index: true },
  lockedAt: { type: Date, default: null },
  lockedBy: { type: String, default: '' },
  error: {
    code: { type: String, default: '' },
    message: { type: String, default: '' }
  },
  expiresAt: { type: Date, required: true }
}, { timestamps: true, collection: 'skill_import_jobs' });

skillImportJobSchema.index({ status: 1, nextRunAt: 1, createdAt: 1 });
skillImportJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.SkillImportJob || mongoose.model('SkillImportJob', skillImportJobSchema);
