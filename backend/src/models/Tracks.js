const mongoose = require('mongoose');

const tracksSchema = new mongoose.Schema({
  event: {
    type: String,
    required: true,
    index: true
  },
  uid: {
    type: String,
  },
  teamId: {
    type: String,
    index: true
  },
  tmbId: {
    type: String,
    ref: 'Users',
    index: true
  },
  appType: {
    type: String,
    required: true,
    enum: ['fastgpt', 'link'],
    default: 'fastgpt',
    index: true
  },
  data: {
    type: {
      type: String
    },
    appId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Apps'
    }
  },
  createTime: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Create compound index for efficient queries
tracksSchema.index({ uid: 1, event: 1 });
tracksSchema.index({ event: 1, createTime: -1 });

// Compound index for app type statistics
tracksSchema.index({ appType: 1, event: 1, createTime: -1 });

module.exports = mongoose.model('Tracks', tracksSchema);