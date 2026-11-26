const mongoose = require('mongoose');
const { getDefaultFastgptApiBaseUrl } = require('../config/fastgpt');

const wecomBotBindingSchema = new mongoose.Schema({
  appId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Apps',
    required: true,
    unique: true
  },
  appSource: {
    type: String,
    enum: ['fastgpt'],
    default: 'fastgpt',
    required: true,
    immutable: true
  },
  botId: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  secretCiphertext: {
    type: String,
    required: true,
    select: false
  },
  secretVersion: {
    type: String,
    required: true,
    default: 'v1'
  },
  enabled: {
    type: Boolean,
    default: false,
    index: true
  },
  botPrefix: {
    type: String,
    default: '',
    trim: true,
    maxlength: 32
  },
  showToolMessages: {
    type: Boolean,
    default: false
  },
  showReasoning: {
    type: Boolean,
    default: false
  },
  privateChatPolicy: {
    type: String,
    enum: ['reply_all', 'disabled'],
    default: 'reply_all'
  },
  groupChatMentionEnabled: {
    type: Boolean,
    default: true
  },
  fastgptApiBaseUrl: {
    type: String,
    trim: true,
    maxlength: 2048,
    default: getDefaultFastgptApiBaseUrl
  },
  fastgptOpenApiKeyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FastgptOpenApiKey',
    default: null,
    index: true
  },
  fastgptOpenApiKeyName: {
    type: String,
    default: '',
    trim: true,
    maxlength: 100
  },
  fastgptOpenApiKeyMasked: {
    type: String,
    default: '',
    trim: true,
    maxlength: 32
  },
  fastgptApiKeyCiphertext: {
    type: String,
    default: '',
    select: false
  },
  fastgptApiKeyVersion: {
    type: String,
    default: 'v1'
  },
  connectionStatusSnapshot: {
    type: String,
    enum: ['stopped', 'starting', 'connected', 'reconnecting', 'failed'],
    default: 'stopped'
  },
  lastConnectedAtSnapshot: {
    type: Date,
    default: null
  },
  lastErrorSnapshot: {
    type: String,
    default: '',
    maxlength: 500
  },
  createdBy: {
    type: String,
    required: true
  },
  updatedBy: {
    type: String,
    required: true
  }
}, {
  collection: 'wecom_bot_bindings',
  timestamps: true
});

wecomBotBindingSchema.index({ enabled: 1, updatedAt: -1 });
wecomBotBindingSchema.index({ updatedAt: -1 });

module.exports = mongoose.models.WecomBotBinding ||
  mongoose.model('WecomBotBinding', wecomBotBindingSchema);
