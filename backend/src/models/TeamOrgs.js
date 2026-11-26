const mongoose = require('mongoose');

const TeamOrgsSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Teams',
    index: true
  },
  path: {
    type: String,
    default: '',
    index: true
  },
  name: {
    type: String,
    required: true
  },
  pathId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  updateTime: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'team_orgs',
  timestamps: true
});

// 索引优化
TeamOrgsSchema.index({ teamId: 1, path: 1 });
TeamOrgsSchema.index({ name: 'text' });

module.exports = mongoose.model('TeamOrgs', TeamOrgsSchema);
