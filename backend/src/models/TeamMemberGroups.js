const mongoose = require('mongoose');

const teamMemberGroupsSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  avatar: {
    type: String
  },
  updateTime: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'team_member_groups',
  timestamps: false
});

teamMemberGroupsSchema.index({ teamId: 1, name: 1 });

module.exports = mongoose.model('TeamMemberGroups', teamMemberGroupsSchema);
