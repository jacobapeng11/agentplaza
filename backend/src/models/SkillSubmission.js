const mongoose = require('mongoose');

const skillSubmissionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  operator: {
    badge: { type: String, required: true },
    name: { type: String, default: '' },
    departmentCode: { type: String, default: '' }
  },
  parseItem: { type: mongoose.Schema.Types.Mixed, required: true },
  selection: {
    name: { type: String, required: true },
    summary: { type: String, default: '' },
    tags: { type: [String], default: [] },
    changeLog: { type: String, default: '' }
  },
  status: { type: String, enum: ['pending', 'publishing', 'approved', 'rejected'], default: 'pending' },
  reviewStartedAt: Date,
  reviewedAt: Date,
  reviewedBy: String,
  skillId: { type: mongoose.Schema.Types.ObjectId, ref: 'Skill' }
}, { timestamps: true, collection: 'skill_submissions' });

skillSubmissionSchema.index({ status: 1, createdAt: 1, _id: 1 });
skillSubmissionSchema.index(
  { 'selection.name': 'text', 'selection.summary': 'text', 'selection.tags': 'text', 'operator.name': 'text', 'operator.badge': 'text' },
  {
    name: 'skill_submission_search_text',
    default_language: 'none',
    weights: { 'selection.name': 8, 'selection.tags': 4, 'operator.name': 3, 'operator.badge': 3, 'selection.summary': 2 }
  }
);

module.exports = mongoose.models.SkillSubmission || mongoose.model('SkillSubmission', skillSubmissionSchema);
