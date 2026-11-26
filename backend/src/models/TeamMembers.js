/**
 * 团队成员模型
 * 用于管理团队成员信息
 */
const mongoose = require('mongoose');

const teamMembersSchema = new mongoose.Schema({
  // 团队ID
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Teams',
    index: true
  },
  // 用户ID
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Users',
    index: true
  },
  // 头像
  avatar: {
    type: String,
    default: '/icon/logo.svg'
  },
  // 成员名称（员工工号）
  name: {
    type: String,
    required: true,
    index: true
  },
  // 状态
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending'],
    default: 'active'
  },
  // 角色
  role: {
    type: String,
    enum: ['owner', 'admin', 'member', 'visitor'],
    default: 'member'
  },
  // 创建时间
  createTime: {
    type: Date,
    default: Date.now
  },
  __v: {
    type: Number,
    default: 0
  }
}, {
  timestamps: false, // 不自动添加 createdAt 和 updatedAt
  collection: 'team_members' // 指定集合名称
});

// 创建复合索引以提高查询性能
teamMembersSchema.index({ teamId: 1, userId: 1 }, { unique: true }); // 保证团队中用户唯一

const TeamMembers = mongoose.model('TeamMembers', teamMembersSchema);

module.exports = TeamMembers;
