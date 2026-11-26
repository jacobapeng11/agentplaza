const mongoose = require('mongoose');

const appsLinkSchema = new mongoose.Schema({
  teamId: { type: String, required: true },
  tmbId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
  type: { type: String, required: true, default: 'simple' },
  version: { type: String, required: true, default: 'v2' },
  avatar: { type: String, required: true },
  intro: { type: String, required: true, maxlength: 500 },
  inheritPermission: { type: Boolean, required: true, default: true },
  newType: { type: String, required: true, index: true },
  tags: {
    type: [String],
    default: [],
    validate: {
      validator: function(v) { return v.length <= 5; },
      message: 'tags cannot have more than 5 items'
    }
  },
  isPinned: { type: Boolean, default: false },
  pinnedAt: { type: Date, default: null },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  chatCount: { type: Number, default: 0 },
  userCount: { type: Number, default: 0 },
  favoriteCount: { type: Number, default: 0 },
  hotScore: { type: Number, default: 0, index: true },
  deptPermissions: {
    type: [String],
    default: [],
    index: true,
    validate: {
      validator: function(v) { return v.length <= 20; },
      message: 'deptPermissions cannot exceed 20 items'
    }
  },
  userPermissions: {
    type: [String],
    default: [],
    index: true,
    validate: {
      validator: function(v) { return v.length <= 100; },
      message: 'userPermissions cannot exceed 100 items'
    }
  },
  creator: {
    Badge: { type: String, required: true, index: true },
    Name: { type: String, required: true }
  },
  appUrl: {
    type: String,
    required: true,
    validate: {
      validator: function(v) { return /^https?:\/\/.+/.test(v); },
      message: 'appUrl must be a valid HTTP/HTTPS URL'
    }
  },
  updater: {
    at: { type: Date, required: true, default: Date.now },
    by: { type: String, required: true }
  }
}, {
  timestamps: true,
  collection: 'apps_link'
});

// 复合索引 - 支持"我创建的"查询
appsLinkSchema.index({ 'creator.Badge': 1, createdAt: -1 });

// 复合索引 - 支持按分类 + 热度排序
appsLinkSchema.index({ newType: 1, hotScore: -1 });

// 复合索引 - 支持按分类 + 最新排序
appsLinkSchema.index({ newType: 1, createdAt: -1 });

// 文本搜索索引
appsLinkSchema.index({ name: 'text', intro: 'text', tags: 'text' });

module.exports = mongoose.model('AppsLink', appsLinkSchema);
