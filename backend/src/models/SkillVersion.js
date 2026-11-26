const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
  bucket: { type: String, required: true },
  objectKey: { type: String, required: true },
  originalName: { type: String, default: '' },
  size: { type: Number, default: 0 },
  sha256: { type: String, required: true },
  contentType: { type: String, default: 'application/zip' }
}, { _id: false });

const fileSchema = new mongoose.Schema({
  path: { type: String, required: true },
  size: { type: Number, default: 0 },
  compressedSize: { type: Number, default: 0 }
}, { _id: false });

const skillVersionSchema = new mongoose.Schema({
  skillId: { type: mongoose.Schema.Types.ObjectId, ref: 'Skill', required: true, index: true },
  version: { type: String, required: true },
  revision: { type: Number, required: true },
  manifestId: { type: String, default: null },
  sourcePath: { type: String, default: 'SKILL.md' },
  status: { type: String, enum: ['published', 'offline'], default: 'published' },
  changeLog: { type: String, default: '' },
  skillMdContent: { type: String, default: '', maxlength: 1048576 },
  parsedMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  package: { type: packageSchema, required: true },
  fileManifest: { type: [fileSchema], default: [] },
  contentFingerprint: { type: String, required: true, index: true },
  sourceSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  scan: {
    status: { type: String, enum: ['passed', 'failed', 'unscanned'], default: 'passed' },
    warnings: { type: [String], default: [] },
    scannedAt: { type: Date, default: Date.now }
  },
  createdBy: {
    badge: { type: String, required: true },
    name: { type: String, default: '' }
  },
  publishedAt: { type: Date, default: Date.now }
}, { timestamps: true, collection: 'skill_versions' });

skillVersionSchema.index({ skillId: 1, revision: -1 }, { unique: true });
skillVersionSchema.index({ skillId: 1, version: 1 }, { unique: true });
skillVersionSchema.index({ 'package.sha256': 1 });

module.exports = mongoose.models.SkillVersion || mongoose.model('SkillVersion', skillVersionSchema);
