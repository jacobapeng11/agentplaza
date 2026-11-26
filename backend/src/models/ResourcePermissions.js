/**
 * 资源权限模型
 * 用于管理资源（应用）的访问权限
 */
const mongoose = require('mongoose');

const resourcePermissionsSchema = new mongoose.Schema({
  // 资源ID（对应 apps 表的 _id）
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Apps',
    index: true
  },
  // 资源类型
  resourceType: {
    type: String,
    required: true,
    enum: ['app', 'dataset', 'plugin'], // 可以根据实际需求扩展
    index: true
  },
  // 团队ID
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Teams',
    index: true
  },
  // 团队成员ID
  tmbId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TeamMembers',
    index: true
  },
  // 部门ID（对应 team_orgs 表的 _id），用于部门级权限
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TeamOrgs',
    index: true
  },
  // 成员组ID（对应 team_member_groups 表的 _id），用于 FastGPT 成员组权限
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TeamMemberGroups',
    index: true
  },
  // 权限级别
  permission: {
    type: Number,
    required: true,
    default: 1
    // 权限级别说明：
    // FastGPT 使用位角色值：
    // 1: 管理（包含编辑和读取）
    // 2: 编辑（包含读取）
    // 4: 读取
    // 8: 查看对话日志
    // 4294967295: Owner
  },
  __v: {
    type: Number,
    default: 0
  }
}, {
  timestamps: false, // 不自动添加 createdAt 和 updatedAt
  collection: 'resource_permissions' // 指定集合名称
});

// 创建复合索引以提高查询性能
resourcePermissionsSchema.index({ tmbId: 1, teamId: 1, resourceType: 1 });
resourcePermissionsSchema.index({ resourceId: 1, resourceType: 1 });
resourcePermissionsSchema.index({ teamId: 1, resourceType: 1, permission: 1 });
resourcePermissionsSchema.index({ orgId: 1, resourceType: 1, permission: 1 });
resourcePermissionsSchema.index({ groupId: 1, resourceType: 1, permission: 1 });

const ResourcePermissions = mongoose.model('ResourcePermissions', resourcePermissionsSchema);

module.exports = ResourcePermissions;
