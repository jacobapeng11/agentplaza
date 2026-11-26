const mongoose = require('mongoose');

const wecomBotMediaAssetSchema = new mongoose.Schema({
  bindingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WecomBotBinding',
    required: true,
    index: true
  },
  messageId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  direction: {
    type: String,
    enum: ['inbound', 'outbound'],
    required: true,
    index: true
  },
  externalUserId: {
    type: String,
    trim: true,
    default: ''
  },
  conversationKey: {
    type: String,
    trim: true,
    default: '',
    index: true
  },
  mediaKind: {
    type: String,
    enum: ['image', 'file'],
    required: true,
    index: true
  },
  source: {
    type: String,
    enum: ['wecom', 'fastgpt', 'oss'],
    required: true
  },
  originalName: {
    type: String,
    trim: true,
    default: '',
    maxlength: 255
  },
  mimeType: {
    type: String,
    trim: true,
    default: '',
    maxlength: 120
  },
  extension: {
    type: String,
    trim: true,
    default: '',
    maxlength: 20
  },
  size: {
    type: Number,
    default: 0,
    min: 0
  },
  wecomMediaIdHash: {
    type: String,
    default: '',
    index: true
  },
  ossUrl: {
    type: String,
    required: true
  },
  ossUrlHash: {
    type: String,
    required: true
  },
  ossBucketName: {
    type: String,
    default: 'hr-system',
    required: true,
    index: true
  },
  ossFolderName: {
    type: String,
    required: true
  },
  ossObjectKey: {
    type: String,
    default: ''
  },
  sha256: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'uploaded', 'sent', 'failed'],
    default: 'uploaded',
    index: true
  },
  errorSummary: {
    type: String,
    default: '',
    maxlength: 500
  }
}, {
  collection: 'wecom_bot_media_assets',
  timestamps: true
});

wecomBotMediaAssetSchema.index({ bindingId: 1, messageId: 1, direction: 1, mediaKind: 1 });
wecomBotMediaAssetSchema.index({ ossUrlHash: 1 });
wecomBotMediaAssetSchema.index({ sha256: 1 });
wecomBotMediaAssetSchema.index({ createdAt: -1 });

module.exports = mongoose.models.WecomBotMediaAsset ||
  mongoose.model('WecomBotMediaAsset', wecomBotMediaAssetSchema);
