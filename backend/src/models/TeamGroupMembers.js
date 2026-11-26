const mongoose = require('mongoose');

const teamGroupMembersSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'TeamMemberGroups',
    index: true
  },
  tmbId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'TeamMembers',
    index: true
  },
  role: {
    type: String,
    default: 'member'
  }
}, {
  collection: 'team_group_members',
  timestamps: false
});

module.exports = mongoose.model('TeamGroupMembers', teamGroupMembersSchema);
