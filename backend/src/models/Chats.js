const mongoose = require('mongoose');

const chatsSchema = new mongoose.Schema({
  appid: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Apps',
    index: true
  },
  source: String,
  title: {
    type: String,
    required: true
  },
  updateTime: Date,
  createdTime: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Chats', chatsSchema);