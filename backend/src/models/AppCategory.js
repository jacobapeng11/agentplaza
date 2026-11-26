/**
 * AppCategory 模型
 * 
 * 用于存储应用的新分类信息
 * 这是一个独立的映射表，将应用ID映射到新的分类系统
 * 
 * 字段说明：
 * - appId: 应用ID（对应 apps 表的 _id）
 * - newType: 新分类（推荐、大市场、财经类、办公类、行政类、研发类、综合类）
 * - createdAt: 创建时间
 * - updatedAt: 更新时间
 */

const mongoose = require('mongoose');

const appCategorySchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    unique: true,
    comment: '应用ID，对应apps表的_id'
  },
  newType: {
    type: String,
    required: true,
    enum: ['大市场', '财经类', '办公类', '行政类', '研发类', '综合类'],
    default: '综合类',
    comment: '新分类'
  },
  tags: {
    type: [String],
    default: [],
    comment: '分类标签数组'
  },
  isPinned: {
    type: Boolean,
    default: false,
    comment: '是否置顶'
  },
  pinnedAt: {
    type: Date,
    default: null,
    comment: '置顶时间'
  },
  isDeleted: {
    type: Boolean,
    default: false,
    comment: '是否已删除（软删除）'
  },
  deletedAt: {
    type: Date,
    default: null,
    comment: '删除时间'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    comment: '创建时间'
  },
  updatedAt: {
    type: Date,
    default: Date.now,
    comment: '更新时间'
  }
}, {
  timestamps: true,
  collection: 'app_categories',
  versionKey: false
});

// 索引
appCategorySchema.index({ newType: 1 });
appCategorySchema.index({ updatedAt: -1 });
appCategorySchema.index({ newType: 1, updatedAt: -1 });
appCategorySchema.index({ isPinned: -1, pinnedAt: -1 });
appCategorySchema.index({ newType: 1, isPinned: -1, updatedAt: -1 });

// 实例方法：更新分类
appCategorySchema.methods.updateCategory = async function(newType) {
  const validTypes = ['大市场', '财经类', '办公类', '行政类', '研发类', '综合类'];
  if (!validTypes.includes(newType)) {
    throw new Error(`无效的分类。有效分类: ${validTypes.join(', ')}`);
  }
  this.newType = newType;
  this.updatedAt = new Date();
  return this.save();
};

// 静态方法：根据appId获取分类
appCategorySchema.statics.getCategoryByAppId = async function(appId) {
  const record = await this.findOne({ appId });
  return record ? record.newType : '综合类'; // 默认返回 综合类
};

// 静态方法：批量获取分类
appCategorySchema.statics.getCategoriesByAppIds = async function(appIds) {
  const records = await this.find({ appId: { $in: appIds } }).lean();
  const categoryMap = {};
  
  // 初始化所有appId为默认分类、空标签和非置顶
  appIds.forEach(id => {
    categoryMap[id] = { 
      newType: '综合类', 
      tags: [], 
      isPinned: false,
      pinnedAt: null,
      isDeleted: false
    };
  });
  
  // 更新已有记录的分类、标签和置顶信息
  records.forEach(record => {
    categoryMap[record.appId] = {
      newType: record.newType || '综合类',
      tags: Array.isArray(record.tags) ? record.tags : [],
      isPinned: record.isPinned || false,
      pinnedAt: record.pinnedAt || null,
      isDeleted: record.isDeleted || false
    };
  });
  
  return categoryMap;
};

// 静态方法：按分类统计应用数量
appCategorySchema.statics.getStatsByCategory = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$newType',
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        category: '$_id',
        count: 1,
        _id: 0
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
  
  return stats;
};

// 静态方法：获取指定分类的应用ID列表
appCategorySchema.statics.getAppIdsByCategory = async function(category, options = {}) {
  const { limit, skip = 0, sort = { updatedAt: -1 } } = options;
  
  const query = this.find({ newType: category })
    .select('appId')
    .sort(sort)
    .skip(skip);
  
  if (limit) {
    query.limit(limit);
  }
  
  const records = await query.lean();
  return records.map(record => record.appId);
};

// 静态方法：批量更新分类
appCategorySchema.statics.batchUpdateCategory = async function(appIds, newType) {
  const validTypes = ['大市场', '财经类', '办公类', '行政类', '研发类', '综合类'];
  if (!validTypes.includes(newType)) {
    throw new Error(`无效的分类。有效分类: ${validTypes.join(', ')}`);
  }
  
  return this.updateMany(
    { appId: { $in: appIds } },
    { 
      $set: { 
        newType: newType,
        updatedAt: new Date()
      }
    }
  );
};

// 静态方法：创建或更新应用分类
appCategorySchema.statics.upsertCategory = async function(appId, newType = '综合类') {
  const validTypes = ['大市场', '财经类', '办公类', '行政类', '研发类', '综合类'];
  if (!validTypes.includes(newType)) {
    throw new Error(`无效的分类。有效分类: ${validTypes.join(', ')}`);
  }
  
  return this.findOneAndUpdate(
    { appId },
    { 
      $set: { 
        newType,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true, new: true }
  );
};

// 静态方法：获取所有分类及其数量
appCategorySchema.statics.getAllCategoriesWithCount = async function() {
  const validTypes = ['大市场', '财经类', '办公类', '行政类', '研发类', '综合类'];
  const stats = await this.getStatsByCategory();
  
  // 创建完整的分类列表
  const categoryMap = {};
  validTypes.forEach(type => {
    categoryMap[type] = 0;
  });
  
  // 填充实际数量
  stats.forEach(stat => {
    categoryMap[stat.category] = stat.count;
  });
  
  // 转换为数组格式
  return validTypes.map(type => ({
    id: type,
    name: type,
    count: categoryMap[type]
  }));
};

const AppCategory = mongoose.model('AppCategory', appCategorySchema);

module.exports = AppCategory;
