const mongoose = require('mongoose');

const wecomBotConversationSchema = new mongoose.Schema({
  bindingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WecomBotBinding',
    required: true,
    index: true
  },
  externalUserId: {
    type: String,
    required: true,
    trim: true
  },
  conversationKey: {
    type: String,
    required: true,
    trim: true
  },
  fastgptUserId: {
    type: String,
    required: true,
    trim: true
  },
  appConversationId: {
    type: String,
    default: ''
  },
  welcomePending: {
    type: Boolean,
    default: false
  },
  variableValues: {
    type: mongoose.Schema.Types.Mixed,
    // 用途: 为每条会话生成独立变量值对象；输入: 无；输出: 空对象。
    default: () => ({})
  },
  pendingVariableForm: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  variableSchemaHash: {
    type: String,
    default: '',
    index: true
  },
  lastVariablePromptAt: {
    type: Date,
    default: null
  },
  lastMessageAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  collection: 'wecom_bot_conversations',
  timestamps: true
});

wecomBotConversationSchema.index({ bindingId: 1, conversationKey: 1 }, { unique: true });
wecomBotConversationSchema.index({ bindingId: 1, externalUserId: 1 });
wecomBotConversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.models.WecomBotConversation ||
  mongoose.model('WecomBotConversation', wecomBotConversationSchema);
