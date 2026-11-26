const mongoose = require('mongoose');

const MCP_SYNC_STATUS = ['creating', 'active', 'updating', 'failed', 'deleting'];
const MCP_TRANSPORTS = ['streamable', 'sse'];
const MCP_VISIBILITY = ['private', 'public', 'restricted'];
const HIGRESS_MCP_TYPES = ['DIRECT_ROUTE', 'OPEN_API'];
const OPEN_API_INPUT_MODES = ['content', 'url'];
const HIGRESS_SERVICE_SOURCE_TYPES = ['static', 'dns', 'nacos', 'nacos2', 'nacos3', 'zookeeper', 'consul', 'eureka'];
const HIGRESS_SERVICE_PROTOCOLS = ['', 'http', 'https'];

const McpServiceSchema = new mongoose.Schema({
  serviceKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  summary: {
    type: String,
    required: true,
    trim: true,
    maxlength: 240
  },
  description: {
    type: String,
    default: '',
    trim: true,
    maxlength: 4000
  },
  avatar: {
    type: String,
    default: '',
    trim: true,
    maxlength: 1024
  },
  category: {
    type: String,
    default: '\u7efc\u5408\u7c7b',
    trim: true,
    index: true
  },
  tags: {
    type: [String],
    default: [],
    validate: {
      validator: function(value) {
        return Array.isArray(value) && value.length <= 5;
      },
      message: 'tags cannot have more than 5 items'
    }
  },
  transport: {
    type: String,
    enum: MCP_TRANSPORTS,
    default: 'streamable'
  },
  higressMcpType: {
    type: String,
    enum: HIGRESS_MCP_TYPES,
    default: 'DIRECT_ROUTE',
    index: true
  },
  openApiInputMode: {
    type: String,
    enum: OPEN_API_INPUT_MODES,
    default: undefined
  },
  serviceSourceType: {
    type: String,
    enum: HIGRESS_SERVICE_SOURCE_TYPES,
    default: 'dns'
  },
  serviceSourceDomain: {
    type: String,
    default: '',
    trim: true,
    maxlength: 256
  },
  serviceSourcePort: {
    type: Number,
    default: 443
  },
  serviceSourceProtocol: {
    type: String,
    enum: HIGRESS_SERVICE_PROTOCOLS,
    default: 'https'
  },
  gatewayDomain: {
    type: String,
    default: '',
    trim: true,
    maxlength: 256
  },
  gatewayPath: {
    type: String,
    default: '/mcp',
    trim: true,
    maxlength: 256
  },
  visibilityMode: {
    type: String,
    enum: MCP_VISIBILITY,
    default: 'private',
    index: true
  },
  userPermissions: {
    type: [String],
    default: [],
    index: true,
    validate: {
      validator: function(value) {
        return Array.isArray(value) && value.length <= 100;
      },
      message: 'userPermissions cannot exceed 100 items'
    }
  },
  deptPermissions: {
    type: [String],
    default: [],
    index: true,
    validate: {
      validator: function(value) {
        return Array.isArray(value) && value.length <= 20;
      },
      message: 'deptPermissions cannot exceed 20 items'
    }
  },
  viewCount: {
    type: Number,
    default: 0,
    min: 0,
    index: true
  },
  isPinned: {
    type: Boolean,
    default: false,
    index: true
  },
  pinnedAt: {
    type: Date,
    default: null
  },
  owner: {
    userId: { type: String, required: true, index: true },
    badge: { type: String, required: true, index: true },
    name: { type: String, required: true },
    departmentCode: { type: String, default: '' }
  },
  upstreamUrlCiphertext: {
    type: String,
    default: ''
  },
  upstreamUrlVersion: {
    type: String,
    default: ''
  },
  openApiContentCiphertext: {
    type: String,
    default: ''
  },
  openApiContentVersion: {
    type: String,
    default: ''
  },
  openApiUrlCiphertext: {
    type: String,
    default: ''
  },
  openApiUrlVersion: {
    type: String,
    default: ''
  },
  openApiRawConfigCiphertext: {
    type: String,
    default: ''
  },
  openApiRawConfigVersion: {
    type: String,
    default: ''
  },
  openApiAuthConfigCiphertext: { type: String, default: '' },
  openApiAuthConfigVersion: { type: String, default: '' },
  gatewayAccessUrl: {
    type: String,
    default: ''
  },
  debugGatewayAccessUrl: {
    type: String,
    default: ''
  },
  higressRouteName: {
    type: String,
    default: '',
    index: true
  },
  routePluginConfigCiphertext: {
    type: String,
    default: ''
  },
  routePluginConfigVersion: {
    type: String,
    default: ''
  },  higressServiceSourceName: {
    type: String,
    default: '',
    index: true
  },
  higressMcpServerName: {
    type: String,
    default: '',
    index: true
  },
  syncStatus: {
    type: String,
    enum: MCP_SYNC_STATUS,
    default: 'creating',
    index: true
  },
  syncMessage: {
    type: String,
    default: ''
  },
  lastErrorCode: {
    type: String,
    default: ''
  },
  lastSyncedAt: {
    type: Date,
    default: null
  },
  toolCount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastToolDiscoveryAt: {
    type: Date,
    default: null
  },
  lastToolDiscoveryFailedAt: {
    type: Date,
    default: null
  },
  lastToolDiscoveryError: {
    type: String,
    default: ''
  },
  toolSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  lastSyncRequestedAt: {
    type: Date,
    default: null
  }
}, {
  collection: 'mcp_services',
  timestamps: true
});

McpServiceSchema.index({ 'owner.badge': 1, updatedAt: -1 });
McpServiceSchema.index({ visibilityMode: 1, syncStatus: 1, updatedAt: -1 });
McpServiceSchema.index({ visibilityMode: 1, syncStatus: 1, viewCount: -1, updatedAt: -1 });
McpServiceSchema.index({ isPinned: -1, pinnedAt: -1 });
McpServiceSchema.index({ category: 1, isPinned: -1, pinnedAt: -1, createdAt: -1 });
McpServiceSchema.index({ userPermissions: 1, visibilityMode: 1, updatedAt: -1 });
McpServiceSchema.index({ deptPermissions: 1, visibilityMode: 1, updatedAt: -1 });
McpServiceSchema.index({ category: 1, updatedAt: -1 });
McpServiceSchema.index({ tags: 1 });
McpServiceSchema.index({ displayName: 'text', summary: 'text', description: 'text', tags: 'text' });

module.exports = {
  McpService: mongoose.models.McpService || mongoose.model('McpService', McpServiceSchema),
  MCP_SYNC_STATUS,
  MCP_TRANSPORTS,
  MCP_VISIBILITY,
  HIGRESS_MCP_TYPES,
  OPEN_API_INPUT_MODES,
  HIGRESS_SERVICE_SOURCE_TYPES,
  HIGRESS_SERVICE_PROTOCOLS
};

