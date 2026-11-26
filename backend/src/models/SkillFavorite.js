const mongoose = require('mongoose');

const skillFavoriteSchema = new mongoose.Schema({
  skillId: { type: mongoose.Schema.Types.ObjectId, ref: 'Skill', required: true, index: true },
  userBadge: { type: String, required: true, index: true },
  userName: { type: String, default: '' }
}, { timestamps: true, collection: 'skill_favorites' });

skillFavoriteSchema.index({ skillId: 1, userBadge: 1 }, { unique: true });

module.exports = mongoose.models.SkillFavorite || mongoose.model('SkillFavorite', skillFavoriteSchema);
