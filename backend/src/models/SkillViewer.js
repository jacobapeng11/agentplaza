const mongoose = require('mongoose');

const skillViewerSchema = new mongoose.Schema({
  skillId: { type: mongoose.Schema.Types.ObjectId, ref: 'Skill', required: true },
  userBadge: { type: String, required: true, trim: true },
  userName: { type: String, default: '', trim: true },
  firstViewedAt: { type: Date, default: Date.now },
  lastViewedAt: { type: Date, default: Date.now },
  lastCountedAt: { type: Date, default: null }
}, { timestamps: true, collection: 'skill_viewers' });

skillViewerSchema.index({ skillId: 1, userBadge: 1 }, { unique: true });
skillViewerSchema.index({ skillId: 1, firstViewedAt: -1 });

const SkillViewer = mongoose.models.SkillViewer || mongoose.model('SkillViewer', skillViewerSchema);

module.exports = SkillViewer;
