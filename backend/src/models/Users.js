const mongoose = require('mongoose');

const usersSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  userName: {
    type: String,
    trim: true
  },
  password: {
    type: String,
    required: false,  // OAuth登录时不需要密码
    default: 'oauth_user'  // OAuth用户的默认标识
  },
  status: {
    type: String,
    default: 'active'
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  qw_token: {
    type: String,
    trim: true
  },
  qwBoundAt: {
    type: Date
  },
  qwLastUsedAt: {
    type: Date
  },
  createdTime: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

usersSchema.index(
  { qw_token: 1 },
  {
    unique: true,
    partialFilterExpression: { qw_token: { $type: 'string' } }
  }
);

module.exports = mongoose.model('Users', usersSchema);
