const mongoose = require('mongoose');

const collectSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
    index: true
  },
  appId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Apps',
    index: true
  },
  appName: String,
  appType: {
    type: String,
    required: true,
    enum: ['fastgpt', 'link', 'mcp'],
    default: 'fastgpt',
    index: true
  },
  createTime: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Compound unique index to prevent duplicate collections
collectSchema.index({ userId: 1, appId: 1 }, { unique: true });

// Compound index for querying by user + app type
collectSchema.index({ userId: 1, appType: 1, createTime: -1 });

module.exports = mongoose.model('Collect', collectSchema);