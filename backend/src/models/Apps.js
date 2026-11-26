const mongoose = require('mongoose');

const appsSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  type: {
    type: String,
    index: true
  },
  updateTime: {
    type: Date,
    default: Date.now,
    index: true
  },
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  tmbId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Users',
    index: true
  },
  version: String,
  avatar: String,
  inheritPermission: {
    type: Boolean,
    default: true
  },
  likeCount: {
    type: Number,
    default: 0
  },
  favoriteCount: {
    type: Number,
    default: 0
  },
  chatCount: {
    type: Number,
    default: 0
  },
  userCount: {
    type: Number,
    default: 0
  },
  hotScore: {
    type: Number,
    default: 0,
    index: true // For sorting by hotScore
  }
}, {
  timestamps: true
});

// Text index for search functionality
appsSchema.index({ name: 'text' });

module.exports = mongoose.model('Apps', appsSchema);
