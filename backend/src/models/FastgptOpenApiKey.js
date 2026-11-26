const mongoose = require('mongoose');

const fastgptOpenApiKeySchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'teams',
    required: true,
    index: true
  },
  tmbId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'team_members',
    required: true,
    index: true
  },
  apiKey: {
    type: String,
    required: true,
    select: false
  },
  appId: {
    type: String
  },
  name: {
    type: String,
    required: true,
    trim: true,
    default: 'Api Key',
    maxlength: 100
  },
  createTime: {
    type: Date,
    default: Date.now,
    index: true
  },
  lastUsedTime: {
    type: Date,
    default: null
  },
  usagePoints: {
    type: Number,
    default: 0
  },
  limit: {
    maxUsagePoints: {
      type: Number,
      default: -1
    },
    expiredTime: {
      type: Date,
      default: null
    }
  }
}, {
  collection: 'openapis'
});

fastgptOpenApiKeySchema.index({ appId: 1, createTime: -1 });
fastgptOpenApiKeySchema.index({ appId: 1, tmbId: 1 });

module.exports = mongoose.models.FastgptOpenApiKey ||
  mongoose.model('FastgptOpenApiKey', fastgptOpenApiKeySchema);
