const mongoose = require('mongoose');

const appChatLogsSchema = new mongoose.Schema({
  appId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Apps'
  },
  chatId: {
    type: String,
    required: true
  },
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  badFeedbackCount: {
    type: Number,
    default: 0
  },
  chatItemCount: {
    type: Number,
    default: 0
  },
  createTime: {
    type: Date,
    default: Date.now
  },
  errorCount: {
    type: Number,
    default: 0
  },
  goodFeedbackCount: {
    type: Number,
    default: 0
  },
  isFirstChat: {
    type: Boolean,
    default: false
  },
  source: {
    type: String,
    default: 'online'
  },
  sourceName: {
    type: String,
    default: ''
  },
  totalPoints: {
    type: Number,
    default: 0
  },
  totalResponseTime: {
    type: Number,
    default: 0
  },
  updateTime: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'app_chat_logs', // 明确指定集合名称
  timestamps: false // 使用自定义的 createTime 和 updateTime
});

// 创建索引以提高查询性能
appChatLogsSchema.index({ appId: 1 });
appChatLogsSchema.index({ userId: 1 });
appChatLogsSchema.index({ createTime: -1 });
appChatLogsSchema.index({ appId: 1, userId: 1 });

module.exports = mongoose.model('AppChatLogs', appChatLogsSchema);