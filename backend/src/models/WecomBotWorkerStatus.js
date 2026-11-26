const mongoose = require('mongoose');

const wecomBotWorkerStatusSchema = new mongoose.Schema({
  bindingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WecomBotBinding',
    required: true,
    index: true
  },
  botId: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  workerId: {
    type: String,
    required: true
  },
  ownerInstanceId: {
    type: String,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['stopped', 'starting', 'connected', 'reconnecting', 'failed'],
    default: 'stopped',
    index: true
  },
  leaseExpiresAt: {
    type: Date,
    required: true,
    index: true
  },
  lastHeartbeatAt: {
    type: Date,
    default: null
  },
  lastConnectedAt: {
    type: Date,
    default: null
  },
  lastError: {
    type: String,
    default: '',
    maxlength: 500
  }
}, {
  collection: 'wecom_bot_worker_status',
  timestamps: true
});

wecomBotWorkerStatusSchema.index({ ownerInstanceId: 1, status: 1 });

module.exports = mongoose.models.WecomBotWorkerStatus ||
  mongoose.model('WecomBotWorkerStatus', wecomBotWorkerStatusSchema);
