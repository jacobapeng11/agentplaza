const mongoose = require('mongoose');

const McpSyncRecordSchema = new mongoose.Schema({
  mcpServiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'McpService',
    required: true,
    index: true
  },
  serviceKey: {
    type: String,
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: ['create', 'update', 'resync'],
    required: true
  },
  status: {
    type: String,
    enum: ['running', 'success', 'failed'],
    default: 'running',
    index: true
  },
  operator: {
    badge: { type: String, required: true },
    name: { type: String, required: true }
  },
  requestSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  responseSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  errorCode: {
    type: String,
    default: ''
  },
  errorMessage: {
    type: String,
    default: ''
  },
  finishedAt: {
    type: Date,
    default: null
  }
}, {
  collection: 'mcp_sync_records',
  timestamps: true
});

McpSyncRecordSchema.index({ mcpServiceId: 1, createdAt: -1 });
McpSyncRecordSchema.index({ serviceKey: 1, createdAt: -1 });

module.exports = mongoose.models.McpSyncRecord || mongoose.model('McpSyncRecord', McpSyncRecordSchema);
