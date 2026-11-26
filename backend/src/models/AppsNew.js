const mongoose = require('mongoose');

const appsNewSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, '应用名称不能为空'],
    trim: true,
    maxlength: [100, '应用名称不能超过100个字符'],
    index: true
  },
  type: {
    type: String,
    index: true
  },
  avatar: {
    type: String,
    default: ''
  },
  backgroundImage: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    trim: true,
    maxlength: [200, '描述不能超过200个字符'],
    default: ''
  },
  teamId: {
    type: String,
    index: true
  },
  tmbId: {
    type: String,
    index: true
  },
  category: {
    type: String,
    enum: {
      values: ['all', 'market', 'finance', 'it-office', 'hr-admin'],
      message: '{VALUE} 不是有效的分类'
    },
    default: 'all',
    required: [true, '分类不能为空'],
    index: true
  },
  tags: {
    type: [String],
    validate: {
      validator: function(v) {
        return v.length <= 4;
      },
      message: '标签数量不能超过4个'
    },
    default: []
  },
  isPinned: {
    type: Boolean,
    default: false,
    index: true
  },
  pinnedAt: {
    type: Date,
    default: null,
    index: true
  },
  likeCount: {
    type: Number,
    default: 0,
    min: [0, '点赞数不能为负数']
  },
  favoriteCount: {
    type: Number,
    default: 0,
    min: [0, '收藏数不能为负数']
  },
  viewCount: {
    type: Number,
    default: 0,
    min: [0, '浏览数不能为负数']
  },
  usageCount: {
    type: Number,
    default: 0,
    min: [0, '使用人数不能为负数']
  },
  hotScore: {
    type: Number,
    default: 0,
    index: true
  },
  version: String,
  inheritPermission: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'apps_new'
});

// 文本搜索索引
appsNewSchema.index({ name: 'text', description: 'text', tags: 'text' });

// 复合索引 - 分类 + 置顶 + 热度排序
appsNewSchema.index({ category: 1, isPinned: -1, hotScore: -1 });

// 复合索引 - 分类 + 置顶 + 创建时间排序
appsNewSchema.index({ category: 1, isPinned: -1, createdAt: -1 });

// 复合索引 - 创建者 + 创建时间
appsNewSchema.index({ tmbId: 1, createdAt: -1 });

// 复合索引 - 置顶应用查询
appsNewSchema.index({ isPinned: -1, pinnedAt: -1 });

// 虚拟字段：格式化创建时间
appsNewSchema.virtual('formattedCreatedAt').get(function() {
  return this.createdAt.toISOString().split('T')[0];
});

// 实例方法：增加浏览次数
appsNewSchema.methods.incrementViewCount = async function() {
  this.viewCount += 1;
  return await this.save();
};

// 实例方法：更新热度分数
appsNewSchema.methods.updateHotScore = async function() {
  // 热度分数计算公式：浏览数 * 0.1 + 收藏数 * 2 + 使用人数 * 5
  this.hotScore = Math.floor(this.viewCount * 0.1 + this.favoriteCount * 2 + this.usageCount * 5);
  return await this.save();
};

// 静态方法：获取分类统计
appsNewSchema.statics.getCategoryStats = async function() {
  return await this.aggregate([
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
};

module.exports = mongoose.model('AppsNew', appsNewSchema);
