const mongoose = require('mongoose');

const teamOrgMembersSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  tmbId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'TeamMembers',
    index: true
  },
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'TeamOrgs',
    index: true
  }
}, {
  collection: 'team_org_members',
  timestamps: false
});

teamOrgMembersSchema.index({ teamId: 1, tmbId: 1 });

module.exports = mongoose.model('TeamOrgMembers', teamOrgMembersSchema);
