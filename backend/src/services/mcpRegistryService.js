const mongoose = require('mongoose');
const { resolveAdminBadges } = require('../config/adminBadges');
const logger = require('../utils/logger');
const McpSyncRecord = require('../models/McpSyncRecord');
const Collect = require('../models/Collect');
const Users = require('../models/Users');
const {
  McpService,
  MCP_TRANSPORTS,
  MCP_VISIBILITY,
  HIGRESS_MCP_TYPES,
  OPEN_API_INPUT_MODES,
  HIGRESS_SERVICE_SOURCE_TYPES,
  HIGRESS_SERVICE_PROTOCOLS
} = require('../models/McpService');
const {
  encryptUpstreamUrl,
  decryptUpstreamUrl,
  encryptOpenApiConfig,
  decryptOpenApiConfig,
  encryptOpenApiAuthConfig,
  decryptOpenApiAuthConfig,
  encryptRoutePluginConfig,
  decryptRoutePluginConfig,
  maskUpstreamUrl
} = require('./mcpSecretService');
const { normalizeOpenApiAuthConfig } = require('./mcpPassthroughAuthService');
const { deleteServiceFromHigress, syncServiceToHigress, HigressClientError, buildGatewayAccessUrl, buildRouteAccessUrl } = require('./higressClient');
const { discoverToolsFromUpstream, discoverToolsViaSse } = require('./mcpDiscoveryClient');

class McpDomainError extends Error {
  constructor(message, code = 'MCP_DOMAIN_ERROR', statusCode = 400) {
    super(message);
    this.name = 'McpDomainError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createServiceKey() {
  return new mongoose.Types.ObjectId().toString().slice(-12);
}

function buildHigressNames(serviceKey) {
  return {
    higressServiceSourceName: `svcsrc-${serviceKey}`,
    higressMcpServerName: `mcp-${serviceKey}`,
    higressRouteName: `mcp-route-${serviceKey}`
  };
}

function normalizeText(value, fieldName, maxLength, required = false) {
  const normalized = String(value || '').trim();
  if (required && !normalized) {
    throw new McpDomainError(`${fieldName} is required`, 'VALIDATION_ERROR', 400);
  }
  if (normalized.length > maxLength) {
    throw new McpDomainError(`${fieldName} exceeds max length`, 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

const DEFAULT_MCP_CATEGORY = '\u7efc\u5408\u7c7b';

function normalizeCategory(value) {
  const normalized = normalizeText(value || DEFAULT_MCP_CATEGORY, 'category', 40, false);
  return normalized || DEFAULT_MCP_CATEGORY;
}

function normalizeAvatar(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.length > 1024) {
    throw new McpDomainError('avatar exceeds max length', 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

function normalizeTags(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  const tags = Array.from(new Set(
    source
      .map(item => String(item || '').trim())
      .filter(Boolean)
  ));

  if (tags.length > 5) {
    throw new McpDomainError('tags cannot have more than 5 items', 'VALIDATION_ERROR', 400);
  }

  tags.forEach(tag => {
    if (tag.length > 24) {
      throw new McpDomainError('tag exceeds max length', 'VALIDATION_ERROR', 400);
    }
  });

  return tags;
}

function normalizeTransport(value) {
  if (!MCP_TRANSPORTS.includes(value)) {
    throw new McpDomainError('transport must be streamable or sse', 'VALIDATION_ERROR', 400);
  }
  return value;
}

function normalizeHigressMcpType(value) {
  const normalized = String(value || 'DIRECT_ROUTE').trim() || 'DIRECT_ROUTE';
  if (!HIGRESS_MCP_TYPES.includes(normalized)) {
    throw new McpDomainError('higressMcpType must be DIRECT_ROUTE or OPEN_API', 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

function normalizeVisibility(value) {
  if (!MCP_VISIBILITY.includes(value)) {
    throw new McpDomainError('visibilityMode must be private, public or restricted', 'VALIDATION_ERROR', 400);
  }
  return value;
}

function normalizePermissionEntries(value, fieldName, maxItems) {
  const items = Array.isArray(value) ? value : [];
  const normalized = Array.from(new Set(items.map(item => String(item || '').trim()).filter(Boolean)));

  if (normalized.length > maxItems) {
    throw new McpDomainError(`${fieldName} exceeds max items`, 'VALIDATION_ERROR', 400);
  }

  return normalized;
}

function normalizeUserPermissions(value) {
  return normalizePermissionEntries(value, 'userPermissions', 100);
}

function normalizeDeptPermissions(value) {
  return normalizePermissionEntries(value, 'deptPermissions', 20);
}

function ensurePermissionConsistency(visibilityMode, userPermissions, deptPermissions) {
  if (visibilityMode === 'restricted' && userPermissions.length === 0 && deptPermissions.length === 0) {
    throw new McpDomainError('restricted visibility requires at least one user or department permission', 'VALIDATION_ERROR', 400);
  }
}

function buildHasSecretConfig(service, openApiConfig = null) {
  return {
    upstreamUrl: Boolean(service.upstreamUrlCiphertext),
    openApiContent: Boolean(openApiConfig?.openApiContent || service.openApiContentCiphertext),
    openApiUrl: Boolean(openApiConfig?.openApiUrl || service.openApiUrlCiphertext),
    openApiRawConfigurations: Boolean(openApiConfig?.openApiRawConfigurations || service.openApiRawConfigCiphertext),
    openApiAuthConfig: Boolean(service.openApiAuthConfigCiphertext),
    routePluginConfig: Boolean(service.routePluginConfigCiphertext)
  };
}

function buildSourceConfigResponse(service, canAccessClientConfig) {
  const higressMcpType = normalizeHigressMcpType(service.higressMcpType);
  const response = {
    higressMcpType,
    openApiInputMode: service.openApiInputMode || undefined
  };

  if (!canAccessClientConfig) {
    response.hasSecretConfig = buildHasSecretConfig(service);
    return response;
  }

  let openApiConfig = null;

  if (higressMcpType === 'OPEN_API') {
    openApiConfig = decryptOpenApiConfig(service);
    response.openApiContent = openApiConfig.openApiContent || undefined;
    response.openApiUrl = openApiConfig.openApiUrl || undefined;
    response.openApiAuthConfig = service.openApiAuthConfigCiphertext
      ? decryptOpenApiAuthConfig(service)
      : normalizeOpenApiAuthConfig({ enabled: false });
  }

  if (higressMcpType === 'DIRECT_ROUTE') {
    response.routePluginConfig = service.routePluginConfigCiphertext
      ? decryptRoutePluginConfig(service)
      : normalizeRoutePluginConfig({});
  }

  response.hasSecretConfig = buildHasSecretConfig(service, openApiConfig);
  return response;
}

function normalizeUpstreamUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new McpDomainError('upstreamUrl is required', 'VALIDATION_ERROR', 400);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new McpDomainError('upstreamUrl is invalid', 'VALIDATION_ERROR', 400);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new McpDomainError('upstreamUrl must use http or https', 'VALIDATION_ERROR', 400);
  }

  return parsed.toString();
}

function inferServiceSourceFromUpstreamUrl(upstreamUrl) {
  const parsed = new URL(upstreamUrl);
  const isStaticIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname) || parsed.hostname.includes(':');
  const serviceSourcePort = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  return {
    serviceSourceType: isStaticIp ? 'static' : 'dns',
    serviceSourceDomain: isStaticIp ? parsed.host : parsed.hostname,
    serviceSourcePort,
    serviceSourceProtocol: parsed.protocol === 'https:' ? 'https' : 'http'
  };
}

function inferGatewayFromUpstreamUrl(upstreamUrl) {
  const parsed = new URL(upstreamUrl);
  return {
    gatewayDomain: parsed.hostname,
    gatewayPath: parsed.pathname || '/mcp'
  };
}

async function previewMcpConnection(input = {}) {
  const upstreamUrl = normalizeUpstreamUrl(input.upstreamUrl);
  const parsed = new URL(upstreamUrl);
  const source = inferServiceSourceFromUpstreamUrl(upstreamUrl);
  const upstreamPath = `${parsed.pathname || '/'}${parsed.search || ''}`;
  const requestedTransport = input.transport === 'sse' ? 'sse' : 'streamable';

  try {
    const snapshot = await discoverToolsFromUpstream(upstreamUrl, requestedTransport);
    return {
      reachable: true,
      transport: requestedTransport,
      source,
      routeAdaptation: {
        enabled: upstreamPath !== '/' || Boolean(parsed.hostname),
        path: upstreamPath === '/' ? '' : upstreamPath,
        host: parsed.hostname
      },
      toolCount: Number(snapshot.toolCount || 0),
      tools: snapshot.tools || []
    };
  } catch (error) {
    return {
      reachable: false,
      transport: requestedTransport,
      source,
      routeAdaptation: {
        enabled: upstreamPath !== '/' || Boolean(parsed.hostname),
        path: upstreamPath === '/' ? '' : upstreamPath,
        host: parsed.hostname
      },
      toolCount: 0,
      tools: [],
      errorMessage: error.message || '无法连接服务'
    };
  }
}

function normalizeServiceSourceType(value, fallback) {
  const normalized = String(value || fallback || '').trim();
  if (!HIGRESS_SERVICE_SOURCE_TYPES.includes(normalized)) {
    throw new McpDomainError(
      'serviceSourceType must be one of: ' + HIGRESS_SERVICE_SOURCE_TYPES.join(', '),
      'VALIDATION_ERROR',
      400
    );
  }
  return normalized;
}

function normalizeServiceSourceDomain(value, fallback) {
  const normalized = String(value || fallback || '').trim();
  if (!normalized) {
    throw new McpDomainError('serviceSourceDomain is required', 'VALIDATION_ERROR', 400);
  }
  if (normalized.length > 256) {
    throw new McpDomainError('serviceSourceDomain exceeds max length', 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

function normalizeServiceSourcePort(value, fallback) {
  const raw = value ?? fallback;
  const normalized = Number(raw);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
    throw new McpDomainError('serviceSourcePort must be an integer between 1 and 65535', 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

function normalizeServiceSourceProtocol(value, fallback) {
  const normalized = String(value ?? fallback ?? '').trim();
  if (!HIGRESS_SERVICE_PROTOCOLS.includes(normalized)) {
    throw new McpDomainError(
      'serviceSourceProtocol must be one of: ' + HIGRESS_SERVICE_PROTOCOLS.filter(Boolean).join(', '),
      'VALIDATION_ERROR',
      400
    );
  }
  return normalized;
}

function resolveServiceSourceConfig(input, upstreamUrl, existingService = null) {
  const inferred = inferServiceSourceFromUpstreamUrl(upstreamUrl);
  const fallback = existingService ? {
    serviceSourceType: existingService.serviceSourceType || inferred.serviceSourceType,
    serviceSourceDomain: existingService.serviceSourceDomain || inferred.serviceSourceDomain,
    serviceSourcePort: existingService.serviceSourcePort || inferred.serviceSourcePort,
    serviceSourceProtocol: existingService.serviceSourceProtocol || inferred.serviceSourceProtocol
  } : inferred;

  return {
    serviceSourceType: normalizeServiceSourceType(input.serviceSourceType, fallback.serviceSourceType),
    serviceSourceDomain: normalizeServiceSourceDomain(input.serviceSourceDomain, fallback.serviceSourceDomain),
    serviceSourcePort: normalizeServiceSourcePort(input.serviceSourcePort, fallback.serviceSourcePort),
    serviceSourceProtocol: normalizeServiceSourceProtocol(input.serviceSourceProtocol, fallback.serviceSourceProtocol)
  };
}

function normalizeGatewayDomain(value, fallback) {
  const normalized = String(value || fallback || '').trim();
  if (!normalized) {
    throw new McpDomainError('gatewayDomain is required', 'VALIDATION_ERROR', 400);
  }
  if (normalized.length > 256) {
    throw new McpDomainError('gatewayDomain exceeds max length', 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

function normalizeGatewayPath(value, fallback) {
  const normalized = String(value || fallback || '').trim();
  if (!normalized) {
    throw new McpDomainError('gatewayPath is required', 'VALIDATION_ERROR', 400);
  }
  if (!normalized.startsWith('/')) {
    throw new McpDomainError('gatewayPath must start with /', 'VALIDATION_ERROR', 400);
  }
  if (normalized.length > 256) {
    throw new McpDomainError('gatewayPath exceeds max length', 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

function resolveGatewayConfig(input, upstreamUrl, existingService = null) {
  const inferred = inferGatewayFromUpstreamUrl(upstreamUrl);
  const fallback = existingService ? {
    gatewayDomain: existingService.gatewayDomain || inferred.gatewayDomain,
    gatewayPath: existingService.gatewayPath || inferred.gatewayPath
  } : inferred;

  const rawGatewayPath = String(input.gatewayPath || '').trim();
  const gatewayPath = normalizeGatewayPath(rawGatewayPath || fallback.gatewayPath || inferred.gatewayPath, fallback.gatewayPath);

  return {
    gatewayDomain: normalizeGatewayDomain(input.gatewayDomain, fallback.gatewayDomain),
    gatewayPath
  };
}

async function ensureGatewayRouteAvailable(gatewayDomain, gatewayPath, currentServiceId = null) {
  const existing = await McpService.findOne({ gatewayDomain, gatewayPath }).select('_id').lean();
  if (existing && String(existing._id) !== String(currentServiceId || '')) {
    throw new McpDomainError('gatewayPath already exists for this gatewayDomain', 'DUPLICATE_GATEWAY_ROUTE', 409);
  }
}

function ensureNoCustomHeaders(input) {
  if (input && typeof input === 'object' && Object.keys(input).length > 0) {
    throw new McpDomainError('custom upstream headers are not supported in v1', 'FEATURE_NOT_SUPPORTED', 400);
  }
}


function normalizeHeaderEntries(value) {
  return Array.isArray(value)
    ? value
      .map(item => ({ key: normalizeText(item?.key, 'header.key', 128, false), value: String(item?.value || '') }))
      .filter(item => item.key)
    : [];
}

function normalizeHeaderRemoveEntries(value) {
  return Array.isArray(value)
    ? value.map(item => normalizeText(item, 'header.remove', 128, false)).filter(Boolean)
    : [];
}

function normalizeHeaderStageConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    add: normalizeHeaderEntries(source.add),
    set: normalizeHeaderEntries(source.set),
    remove: normalizeHeaderRemoveEntries(source.remove)
  };
}

function normalizeRoutePluginConfig(input = {}, existingConfig = null) {
  const source = input.routePluginConfig && typeof input.routePluginConfig === 'object'
    ? input.routePluginConfig
    : (existingConfig || {});
  const rewrite = source.rewrite && typeof source.rewrite === 'object' ? source.rewrite : {};
  const headerModify = source.headerModify && typeof source.headerModify === 'object' ? source.headerModify : {};
  const keyAuth = source.keyAuth && typeof source.keyAuth === 'object' ? source.keyAuth : {};
  const transformer = source.transformer && typeof source.transformer === 'object' ? source.transformer : {};

  return {
    rewrite: {
      enabled: Boolean(rewrite.enabled),
      path: normalizeText(rewrite.path, 'routePluginConfig.rewrite.path', 256, false),
      host: normalizeText(rewrite.host, 'routePluginConfig.rewrite.host', 256, false)
    },
    headerModify: {
      enabled: Boolean(headerModify.enabled),
      request: normalizeHeaderStageConfig(headerModify.request),
      response: normalizeHeaderStageConfig(headerModify.response)
    },
    keyAuth: {
      enabled: Boolean(keyAuth.enabled),
      allowedCredentialTypes: Array.isArray(keyAuth.allowedCredentialTypes) && keyAuth.allowedCredentialTypes.length
        ? keyAuth.allowedCredentialTypes.map(item => normalizeText(item, 'routePluginConfig.keyAuth.allowedCredentialTypes', 64, false)).filter(Boolean)
        : ['key-auth'],
      allowedConsumers: Array.isArray(keyAuth.allowedConsumers)
        ? keyAuth.allowedConsumers.map(item => normalizeText(item, 'routePluginConfig.keyAuth.allowedConsumers', 128, false)).filter(Boolean)
        : [],
      rawConfigurations: String(keyAuth.rawConfigurations || '').trim()
    },
    transformer: {
      enabled: Boolean(transformer.enabled),
      rawConfigurations: String(transformer.rawConfigurations || '').trim()
    }
  };
}
function isAdmin(user) {
  const adminBadges = resolveAdminBadges();
  return adminBadges.includes(String(user?.Badge || '').trim());
}

function canManageService(user, service) {
  return String(service.owner?.badge || '').trim() === String(user?.Badge || '').trim() || isAdmin(user);
}

function getDepartmentPrefixes(departmentCode) {
  const normalized = String(departmentCode || '').trim();
  const prefixes = [];
  for (let i = 1; i <= normalized.length; i += 1) {
    prefixes.push(normalized.slice(0, i));
  }
  return prefixes;
}

function canUseService(user, service) {
  if (canManageService(user, service)) return true;

  if (service.visibilityMode === 'public') return true;
  if (service.visibilityMode === 'private') return false;

  const badge = String(user?.Badge || '').trim();
  const departmentCode = String(user?.DepartmentCode || '').trim();
  const userPermissions = normalizeUserPermissions(service.userPermissions);
  const deptPermissions = normalizeDeptPermissions(service.deptPermissions);

  if (badge && userPermissions.includes(badge)) return true;
  if (departmentCode && deptPermissions.some(prefix => departmentCode.startsWith(prefix))) return true;

  return false;
}

function canViewService(user, service) {
  return canUseService(user, service);
}

function canAccessClientConfig(user, service) {
  return canViewService(user, service);
}

function buildVisibilityFilter(user) {
  if (isAdmin(user)) {
    return {};
  }

  const filters = [];
  const badge = String(user?.Badge || '').trim();

  if (badge) {
    filters.push({ 'owner.badge': badge });
    filters.push({ visibilityMode: 'public' });
    filters.push({ visibilityMode: 'restricted', userPermissions: badge });
  } else {
    filters.push({ visibilityMode: 'public' });
  }

  const deptPrefixes = getDepartmentPrefixes(user?.DepartmentCode);
  if (deptPrefixes.length > 0) {
    filters.push({ visibilityMode: 'restricted', deptPermissions: { $in: deptPrefixes } });
  }

  return { $or: filters };
}

function buildClientAccessMessage(service) {
  const ownerName = String(service.owner?.name || '').trim();
  const ownerBadge = String(service.owner?.badge || '').trim();
  const ownerText = ownerName && ownerBadge
    ? `${ownerName} (${ownerBadge})`
    : ownerName || ownerBadge || 'owner';

  return `No client access. Contact ${ownerText} for authorization.`;
}

function resolveEffectiveGatewayUrls(service, { canAccessClientConfig = true } = {}) {
  if (!canAccessClientConfig) {
    return {
      gatewayAccessUrl: '',
      debugGatewayAccessUrl: ''
    };
  }

  const debugGatewayAccessUrl = String(service.debugGatewayAccessUrl || service.gatewayAccessUrl || '').trim();
  const type = normalizeHigressMcpType(service.higressMcpType);
  let gatewayAccessUrl = '';
  if (type === 'DIRECT_ROUTE') {
    gatewayAccessUrl = buildRouteAccessUrl(service);
  } else {
    gatewayAccessUrl = buildGatewayAccessUrl(service, service.transport);
  }

  return {
    gatewayAccessUrl: gatewayAccessUrl || debugGatewayAccessUrl,
    debugGatewayAccessUrl
  };
}

function getCollectIdentity(operator) {
  return String(operator?.employeeNumber || operator?.name || operator?.Badge || '').trim();
}

async function getCollectUser(operator) {
  const username = getCollectIdentity(operator);
  if (!username) return null;
  return Users.findOne({ username }).select('_id username').lean();
}

async function buildFavoriteContext(services, operator) {
  const ids = services.map(service => service._id).filter(Boolean);
  if (!ids.length) return { countMap: new Map(), collectedSet: new Set() };

  const collectUser = await getCollectUser(operator);
  const [stats, userCollects] = await Promise.all([
    Collect.aggregate([
      { $match: { appType: 'mcp', appId: { $in: ids } } },
      { $group: { _id: '$appId', favoriteCount: { $sum: 1 } } }
    ]),
    collectUser ? Collect.find({ userId: collectUser._id, appType: 'mcp', appId: { $in: ids } }).select('appId').lean() : []
  ]);

  return {
    countMap: new Map(stats.map(item => [String(item._id), item.favoriteCount || 0])),
    collectedSet: new Set(userCollects.map(item => String(item.appId)))
  };
}

function buildListItem(service, favoriteContext = {}, options = {}) {
  const canAccessClientConfig = options.canAccessClientConfig === true;
  const accessUrls = resolveEffectiveGatewayUrls(service, { canAccessClientConfig });

  return {
    id: String(service._id),
    serviceKey: service.serviceKey,
    displayName: service.displayName,
    summary: service.summary,
    description: service.description,
    avatar: service.avatar || '',
    category: service.category || DEFAULT_MCP_CATEGORY,
    newType: service.category || DEFAULT_MCP_CATEGORY,
    tags: Array.isArray(service.tags) ? service.tags : [],
    higressMcpType: normalizeHigressMcpType(service.higressMcpType),
    transport: service.transport,
    serviceSourceType: service.serviceSourceType,
    serviceSourceDomain: service.serviceSourceDomain,
    serviceSourcePort: service.serviceSourcePort,
    serviceSourceProtocol: service.serviceSourceProtocol,
    gatewayDomain: service.gatewayDomain,
    gatewayPath: service.gatewayPath,
    visibilityMode: service.visibilityMode,
    userPermissions: normalizeUserPermissions(service.userPermissions),
    deptPermissions: normalizeDeptPermissions(service.deptPermissions),
    syncStatus: service.syncStatus,
    syncMessage: service.syncMessage,
    gatewayAccessUrl: accessUrls.gatewayAccessUrl,
    debugGatewayAccessUrl: accessUrls.debugGatewayAccessUrl,
    ownerName: service.owner.name,
    ownerBadge: service.owner.badge,
    viewCount: Number(service.viewCount || 0),
    isPinned: Boolean(service.isPinned),
    pinnedAt: service.pinnedAt || null,
    updatedAt: service.updatedAt,
    createdAt: service.createdAt,
    lastSyncedAt: service.lastSyncedAt,
    isCollected: favoriteContext.collectedSet?.has(String(service._id)) || false,
    favoriteCount: favoriteContext.countMap?.get(String(service._id)) || 0,
    collectCount: favoriteContext.countMap?.get(String(service._id)) || 0,
    hasClientAccess: canAccessClientConfig,
    clientAccessMessage: canAccessClientConfig ? '' : buildClientAccessMessage(service)
  };
}

function buildDetailItem(service, latestSyncRecord, favoriteContext = {}, options = {}) {
  const canAccessClientConfig = options.canAccessClientConfig === true;
  const canManageSourceConfig = options.canManageSourceConfig === true;
  const upstreamUrlResponse = canManageSourceConfig
    ? {
      upstreamUrl: normalizeHigressMcpType(service.higressMcpType) === 'DIRECT_ROUTE' ? decryptUpstreamUrl(service) : '',
      upstreamUrlMasked: false,
      upstreamUrlPlaceholder: ''
    }
    : maskUpstreamUrl(service);

  return {
    ...buildListItem(service, favoriteContext, { canAccessClientConfig }),
    hasSourceConfigAccess: canManageSourceConfig,
    lastErrorCode: service.lastErrorCode,
    toolCount: Number(service.toolCount || 0),
    lastToolDiscoveryAt: service.lastToolDiscoveryAt || null,
    lastToolDiscoveryFailedAt: service.lastToolDiscoveryFailedAt || null,
    lastToolDiscoveryError: service.lastToolDiscoveryError || '',
    toolSnapshot: service.toolSnapshot || null,
    latestSyncRecord: latestSyncRecord ? {
      id: String(latestSyncRecord._id),
      action: latestSyncRecord.action,
      status: latestSyncRecord.status,
      errorCode: latestSyncRecord.errorCode,
      errorMessage: latestSyncRecord.errorMessage,
      createdAt: latestSyncRecord.createdAt,
      finishedAt: latestSyncRecord.finishedAt
    } : null,
    ...upstreamUrlResponse,
    ...buildSourceConfigResponse(service, canManageSourceConfig)
  };
}

function resolveGatewayConfigForMcpType(input, higressMcpType, upstreamUrl, existingService = null) {
  if (higressMcpType === 'DIRECT_ROUTE' && upstreamUrl) {
    return resolveGatewayConfig(input, upstreamUrl, existingService);
  }

  const fallback = existingService ? {
    gatewayDomain: existingService.gatewayDomain,
    gatewayPath: existingService.gatewayPath
  } : {
    gatewayDomain: input.gatewayDomain,
    gatewayPath: input.gatewayPath || '/mcp'
  };

  return {
    gatewayDomain: normalizeGatewayDomain(input.gatewayDomain, fallback.gatewayDomain),
    gatewayPath: normalizeGatewayPath(input.gatewayPath || fallback.gatewayPath || '/mcp', fallback.gatewayPath || '/mcp')
  };
}

function isIpAddress(value) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(String(value || '').trim()) || String(value || '').includes(':');
}

function normalizePlainObject(value, fieldName) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new McpDomainError(`${fieldName} must be an object`, 'VALIDATION_ERROR', 400);
  }
  return value;
}
function normalizeOpenApiInputMode(value, fallback) {
  const normalized = String(value || fallback || '').trim();
  if (!OPEN_API_INPUT_MODES.includes(normalized)) {
    throw new McpDomainError('openApiInputMode must be content or url', 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

function normalizeOpenApiConfig(input = {}, existingConfig = null, isCreate = true) {
  const openApiInputMode = normalizeOpenApiInputMode(input.openApiInputMode, existingConfig?.openApiInputMode);
  const nextOpenApiContent = Object.prototype.hasOwnProperty.call(input, 'openApiContent')
    ? input.openApiContent
    : existingConfig?.openApiContent;
  const nextOpenApiUrl = Object.prototype.hasOwnProperty.call(input, 'openApiUrl')
    ? input.openApiUrl
    : existingConfig?.openApiUrl;
  const openApiContent = openApiInputMode === 'content' ? String(nextOpenApiContent || '').trim() : '';
  const openApiUrl = openApiInputMode === 'url' ? String(nextOpenApiUrl || '').trim() : '';

  if (openApiInputMode === 'content' && !openApiContent) {
    throw new McpDomainError('openApiContent is required', 'VALIDATION_ERROR', 400);
  }

  if (openApiInputMode === 'url') {
    if (!openApiUrl) {
      throw new McpDomainError('openApiUrl is required', 'VALIDATION_ERROR', 400);
    }
    try {
      const parsed = new URL(openApiUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('unsupported protocol');
      }
    } catch (error) {
      throw new McpDomainError('openApiUrl must be a valid http or https URL', 'VALIDATION_ERROR', 400);
    }
  }

  if (isCreate && !openApiContent && !openApiUrl) {
    throw new McpDomainError('OpenAPI content or URL is required', 'VALIDATION_ERROR', 400);
  }

  return {
    openApiInputMode,
    openApiContent,
    openApiUrl,
    openApiRawConfigurations: existingConfig?.openApiRawConfigurations || ''
  };
}

function ensureDirectRouteUpstreamUrl(higressMcpType, upstreamUrl) {
  if (higressMcpType === 'DIRECT_ROUTE' && !String(upstreamUrl || '').trim()) {
    throw new McpDomainError('upstreamUrl is required for DIRECT_ROUTE MCP services', 'VALIDATION_ERROR', 400);
  }
}

function resolveServiceSourceConfigForMcpType(input, higressMcpType, upstreamUrl, openApiConfig = null, existingService = null) {
  if (higressMcpType === 'DIRECT_ROUTE') {
    return resolveServiceSourceConfig(input, upstreamUrl, existingService);
  }

  return {
    serviceSourceType: normalizeServiceSourceType(input.serviceSourceType, existingService?.serviceSourceType || 'dns'),
    serviceSourceDomain: normalizeServiceSourceDomain(input.serviceSourceDomain, existingService?.serviceSourceDomain),
    serviceSourcePort: normalizeServiceSourcePort(input.serviceSourcePort, existingService?.serviceSourcePort || 443),
    serviceSourceProtocol: normalizeServiceSourceProtocol(input.serviceSourceProtocol, existingService?.serviceSourceProtocol || 'https')
  };
}

async function createSyncRecord(service, action, operator, requestSummary) {
  return McpSyncRecord.create({
    mcpServiceId: service._id,
    serviceKey: service.serviceKey,
    action,
    status: 'running',
    operator: {
      badge: operator.Badge,
      name: operator.Name || operator.name || operator.Badge
    },
    requestSummary
  });
}

async function finishSyncRecord(syncRecord, status, payload = {}) {
  syncRecord.status = status;
  syncRecord.responseSummary = payload.responseSummary || {};
  syncRecord.errorCode = payload.errorCode || '';
  syncRecord.errorMessage = payload.errorMessage || '';
  syncRecord.finishedAt = new Date();
  await syncRecord.save();
}

function stripSseSuffix(url) {
  return String(url || '').trim().replace(/\/sse\/?$/i, '');
}

function normalizeDiscoveryTarget(target) {
  if (!target) return null;
  if (typeof target === 'string') {
    const url = target.trim();
    return url ? { url, mode: 'streamable-post', transport: 'streamable' } : null;
  }

  const url = String(target.url || '').trim();
  if (!url) return null;
  return {
    url,
    mode: target.mode === 'sse-session' ? 'sse-session' : 'streamable-post',
    transport: target.transport === 'sse' ? 'sse' : 'streamable'
  };
}

async function refreshToolSnapshot(service, discoveryTargets) {
  const targets = Array.isArray(discoveryTargets) ? discoveryTargets : [discoveryTargets];
  const uniqueTargets = [];
  const seenTargets = new Set();
  for (const target of targets.map(normalizeDiscoveryTarget).filter(Boolean)) {
    const key = `${target.mode}:${target.transport}:${target.url}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    uniqueTargets.push(target);
  }
  if (!uniqueTargets.length) {
    return;
  }

  let lastError = null;
  for (const target of uniqueTargets) {
    try {
      const snapshot = target.mode === 'sse-session'
        ? await discoverToolsViaSse(target.url)
        : await discoverToolsFromUpstream(target.url, target.transport);
      service.toolSnapshot = snapshot;
      service.toolCount = Number(snapshot.toolCount || 0);
      service.lastToolDiscoveryAt = new Date(snapshot.fetchedAt || new Date().toISOString());
      service.lastToolDiscoveryError = '';
      service.lastToolDiscoveryFailedAt = null;
      return;
    } catch (error) {
      lastError = error;
    }
  }

  logger.warn('[mcp] tool discovery failed', lastError?.message);
  service.lastToolDiscoveryError = lastError?.message || 'Tool discovery failed';
  service.lastToolDiscoveryFailedAt = new Date();
}

function buildDiscoveryTargets(type, gatewayUrl, upstreamUrl, transport) {
  const normalizedGatewayUrl = String(gatewayUrl || '').trim();
  const normalizedUpstreamUrl = String(upstreamUrl || '').trim();

  if (type === 'OPEN_API') {
    const streamableGatewayUrl = stripSseSuffix(normalizedGatewayUrl);
    return streamableGatewayUrl
      ? [{ url: streamableGatewayUrl, mode: 'streamable-post', transport: 'streamable' }]
      : [];
  }

  const targets = [];
  for (const url of [normalizedGatewayUrl, normalizedUpstreamUrl].filter(Boolean)) {
    targets.push({ url, mode: 'streamable-post', transport: 'streamable' });
    if (transport === 'sse') {
      targets.push({ url, mode: 'sse-session', transport: 'sse' });
    }
  }
  return targets;
}

function buildHigressSyncService(service) {
  const source = typeof service.toObject === 'function' ? service.toObject() : { ...service };
  const higressMcpType = normalizeHigressMcpType(source.higressMcpType);

if (higressMcpType === 'OPEN_API') {
    const openApiConfig = decryptOpenApiConfig(service);
    source.openApiContent = openApiConfig.openApiContent;
    source.openApiUrl = openApiConfig.openApiUrl;
    source.openApiRawConfigurations = openApiConfig.openApiRawConfigurations;
    source.openApiAuthConfig = service.openApiAuthConfigCiphertext
      ? decryptOpenApiAuthConfig(service)
      : normalizeOpenApiAuthConfig({ enabled: false });
  }

  if (higressMcpType === 'DIRECT_ROUTE') {
    source.routePluginConfig = service.routePluginConfigCiphertext
      ? decryptRoutePluginConfig(service)
      : normalizeRoutePluginConfig({});
  }

  return source;
}

async function executeSync(service, operator, action) {
  const syncRecord = await createSyncRecord(service, action, operator, {
    transport: service.transport,
    visibilityMode: service.visibilityMode,
    userPermissions: normalizeUserPermissions(service.userPermissions),
    deptPermissions: normalizeDeptPermissions(service.deptPermissions),
    serviceSourceType: service.serviceSourceType,
    gatewayDomain: service.gatewayDomain,
    gatewayPath: service.gatewayPath
  });

  try {
    const type = normalizeHigressMcpType(service.higressMcpType);
    let upstreamUrl = '';
    if (type === 'DIRECT_ROUTE') {
      upstreamUrl = decryptUpstreamUrl(service);
    } else if (type === 'OPEN_API') {
      const openApiConfig = decryptOpenApiConfig(service);
      upstreamUrl = openApiConfig.openApiUrl || '';
    }

    const syncService = buildHigressSyncService(service);
    const syncResult = await syncServiceToHigress(syncService, upstreamUrl);
    const gatewayDiscoveryTarget = syncResult.gatewayAccessUrl || syncResult.debugGatewayAccessUrl || '';
    const discoveryTargets = buildDiscoveryTargets(type, gatewayDiscoveryTarget, upstreamUrl, service.transport);
    await refreshToolSnapshot(service, discoveryTargets);

    service.syncStatus = 'active';
    service.syncMessage = 'Synced to Higress';
    service.lastErrorCode = '';
    service.lastSyncedAt = new Date();
    service.lastSyncRequestedAt = new Date();
    service.gatewayAccessUrl = syncResult.gatewayAccessUrl;
    service.debugGatewayAccessUrl = syncResult.debugGatewayAccessUrl || '';
    if (syncResult.openApiRawConfigurations) {
      Object.assign(service, encryptOpenApiConfig({
        openApiRawConfigurations: syncResult.openApiRawConfigurations
      }));
    }
    await service.save();

    await finishSyncRecord(syncRecord, 'success', {
      responseSummary: {
        gatewayAccessUrl: syncResult.gatewayAccessUrl,
        debugGatewayAccessUrl: syncResult.debugGatewayAccessUrl,
        serviceSourceName: service.higressServiceSourceName,
        mcpServerName: service.higressMcpServerName
      }
    });

    return service;
  } catch (error) {
    logger.error('[mcp] sync failed', error.message);
    service.syncStatus = 'failed';
    service.syncMessage = error.message;
    service.lastErrorCode = error.code || 'MCP_SYNC_FAILED';
    service.lastSyncRequestedAt = new Date();
    await service.save();

    await finishSyncRecord(syncRecord, 'failed', {
      errorCode: error.code || 'MCP_SYNC_FAILED',
      errorMessage: error.message,
      responseSummary: error.detail || {}
    });

    return service;
  }
}

async function createMcpService(input, operator) {
  ensureNoCustomHeaders(input.customHeaders);

  const serviceKey = createServiceKey();
  const names = buildHigressNames(serviceKey);
  const higressMcpType = normalizeHigressMcpType(input.higressMcpType);
  const upstreamUrl = higressMcpType === 'DIRECT_ROUTE' ? normalizeUpstreamUrl(input.upstreamUrl) : '';
  const encryptedUrl = upstreamUrl
    ? encryptUpstreamUrl(upstreamUrl)
    : { upstreamUrlCiphertext: '', upstreamUrlVersion: '' };
  const openApiConfig = higressMcpType === 'OPEN_API' ? normalizeOpenApiConfig(input, null, true) : null;
  const openApiAuthConfig = higressMcpType === 'OPEN_API'
    ? normalizeOpenApiAuthConfig(input.openApiAuthConfig || { enabled: false })
    : null;
  const routePluginConfig = higressMcpType === 'DIRECT_ROUTE' ? normalizeRoutePluginConfig(input) : null;
  const serviceSourceConfig = resolveServiceSourceConfigForMcpType(input, higressMcpType, upstreamUrl, openApiConfig);
  const gatewayConfig = resolveGatewayConfigForMcpType(input, higressMcpType, upstreamUrl);
  await ensureGatewayRouteAvailable(gatewayConfig.gatewayDomain, gatewayConfig.gatewayPath);
  const visibilityMode = normalizeVisibility(input.visibilityMode || 'private');
  const userPermissions = normalizeUserPermissions(input.userPermissions);
  const deptPermissions = normalizeDeptPermissions(input.deptPermissions);
  ensurePermissionConsistency(visibilityMode, userPermissions, deptPermissions);

  const service = await McpService.create({
    serviceKey,
    displayName: normalizeText(input.displayName, 'displayName', 120, true),
    summary: normalizeText(input.summary, 'summary', 240, true),
    description: normalizeText(input.description, 'description', 4000, false),
    avatar: normalizeAvatar(input.avatar),
    category: normalizeCategory(input.category),
    tags: normalizeTags(input.tags),
    higressMcpType,
    openApiInputMode: openApiConfig?.openApiInputMode,
    transport: normalizeTransport(input.transport || 'streamable'),
    ...serviceSourceConfig,
    ...gatewayConfig,
    visibilityMode,
    userPermissions,
    deptPermissions,
    owner: {
      userId: operator.userId || operator._id || operator.name,
      badge: operator.Badge,
      name: operator.Name || operator.name || operator.Badge,
      departmentCode: operator.DepartmentCode || ''
    },
    ...encryptedUrl,
    ...(openApiConfig ? encryptOpenApiConfig(openApiConfig) : {}),
    ...(openApiAuthConfig ? encryptOpenApiAuthConfig(openApiAuthConfig) : {}),
    ...(routePluginConfig ? encryptRoutePluginConfig(routePluginConfig) : {}),
    ...names,
    syncStatus: 'creating',
    syncMessage: 'Waiting for Higress sync'
  });

  await executeSync(service, operator, 'create');
  return service;
}

async function updateMcpService(serviceId, input, operator) {
  const service = await McpService.findById(serviceId);
  if (!service) {
    throw new McpDomainError('MCP service not found', 'NOT_FOUND', 404);
  }

  if (!canManageService(operator, service)) {
    throw new McpDomainError('No permission to manage this MCP service', 'FORBIDDEN', 403);
  }

  ensureNoCustomHeaders(input.customHeaders);

  let requiresSync = false;
  let nextVisibilityMode = service.visibilityMode;
  let nextUserPermissions = normalizeUserPermissions(service.userPermissions);
  let nextDeptPermissions = normalizeDeptPermissions(service.deptPermissions);
  const currentHigressMcpType = normalizeHigressMcpType(service.higressMcpType);
  let nextHigressMcpType = currentHigressMcpType;
  let nextOpenApiConfig = null;

  if (input.displayName !== undefined) {
    service.displayName = normalizeText(input.displayName, 'displayName', 120, true);
  }
  if (input.summary !== undefined) {
    service.summary = normalizeText(input.summary, 'summary', 240, true);
  }
  if (input.description !== undefined) {
    service.description = normalizeText(input.description, 'description', 4000, false);
  }
  if (input.avatar !== undefined) {
    service.avatar = normalizeAvatar(input.avatar);
  }
  if (input.category !== undefined) {
    service.category = normalizeCategory(input.category);
  }
  if (input.tags !== undefined) {
    service.tags = normalizeTags(input.tags);
  }
  if (input.visibilityMode !== undefined) {
    nextVisibilityMode = normalizeVisibility(input.visibilityMode);
  }
  if (input.userPermissions !== undefined) {
    nextUserPermissions = normalizeUserPermissions(input.userPermissions);
  }
  if (input.deptPermissions !== undefined) {
    nextDeptPermissions = normalizeDeptPermissions(input.deptPermissions);
  }
  if (input.higressMcpType !== undefined) {
    nextHigressMcpType = normalizeHigressMcpType(input.higressMcpType);
    if (nextHigressMcpType !== currentHigressMcpType) {
      throw new McpDomainError(
        'MCP source type cannot be changed after creation',
        'MCP_TYPE_IMMUTABLE',
        400
      );
    }
  }
  ensurePermissionConsistency(nextVisibilityMode, nextUserPermissions, nextDeptPermissions);
  requiresSync = requiresSync || service.visibilityMode !== nextVisibilityMode;
  requiresSync = requiresSync || JSON.stringify(normalizeUserPermissions(service.userPermissions)) !== JSON.stringify(nextUserPermissions);
  requiresSync = requiresSync || JSON.stringify(normalizeDeptPermissions(service.deptPermissions)) !== JSON.stringify(nextDeptPermissions);
  requiresSync = requiresSync || currentHigressMcpType !== nextHigressMcpType;
  service.visibilityMode = nextVisibilityMode;
  service.userPermissions = nextUserPermissions;
  service.deptPermissions = nextDeptPermissions;
  service.higressMcpType = nextHigressMcpType;
  if (input.transport !== undefined) {
    const transport = normalizeTransport(input.transport);
    requiresSync = requiresSync || service.transport !== transport;
    service.transport = transport;
  }

  if (input.routePluginConfig !== undefined || input.higressMcpType !== undefined) {
    const existingRoutePluginConfig = service.routePluginConfigCiphertext
      ? decryptRoutePluginConfig(service)
      : null;
    const nextRoutePluginConfig = nextHigressMcpType === 'DIRECT_ROUTE'
      ? normalizeRoutePluginConfig(input, existingRoutePluginConfig)
      : normalizeRoutePluginConfig({});
    Object.assign(service, encryptRoutePluginConfig(nextRoutePluginConfig));
    requiresSync = true;
  }
  const nextUpstreamUrl = nextHigressMcpType === 'DIRECT_ROUTE'
    ? (
      input.upstreamUrl !== undefined && String(input.upstreamUrl).trim()
        ? normalizeUpstreamUrl(input.upstreamUrl)
        : (service.upstreamUrlCiphertext ? decryptUpstreamUrl(service) : '')
    )
    : '';
  ensureDirectRouteUpstreamUrl(nextHigressMcpType, nextUpstreamUrl);

if (nextHigressMcpType === 'OPEN_API') {
    const existingOpenApiConfig = service.openApiContentCiphertext || service.openApiUrlCiphertext
      ? { ...decryptOpenApiConfig(service), openApiInputMode: service.openApiInputMode }
      : null;
    nextOpenApiConfig = normalizeOpenApiConfig(input, existingOpenApiConfig, !existingOpenApiConfig);
    if (
      input.openApiInputMode !== undefined
      || input.openApiContent !== undefined
      || input.openApiUrl !== undefined
      || input.higressMcpType !== undefined
    ) {
      service.openApiInputMode = nextOpenApiConfig.openApiInputMode;
      service.openApiContentCiphertext = '';
      service.openApiContentVersion = '';
      service.openApiUrlCiphertext = '';
      service.openApiUrlVersion = '';
      Object.assign(service, encryptOpenApiConfig({
        openApiContent: nextOpenApiConfig.openApiContent,
        openApiUrl: nextOpenApiConfig.openApiUrl
      }));
      service.openApiRawConfigCiphertext = '';
      service.openApiRawConfigVersion = '';
      requiresSync = true;
    }
    if (input.openApiAuthConfig !== undefined) {
      const currentAuthConfig = service.openApiAuthConfigCiphertext
        ? decryptOpenApiAuthConfig(service)
        : normalizeOpenApiAuthConfig({ enabled: false });
      const nextAuthConfig = normalizeOpenApiAuthConfig(input.openApiAuthConfig);
      if (JSON.stringify(currentAuthConfig) !== JSON.stringify(nextAuthConfig)) {
        Object.assign(service, encryptOpenApiAuthConfig(nextAuthConfig));
        requiresSync = true;
      }
    }
  }

  if (
    input.serviceSourceType !== undefined
    || input.serviceSourceDomain !== undefined
    || input.serviceSourcePort !== undefined
    || input.serviceSourceProtocol !== undefined
    || input.upstreamUrl !== undefined
    || input.higressMcpType !== undefined
  ) {
    const nextConfig = resolveServiceSourceConfigForMcpType(input, nextHigressMcpType, nextUpstreamUrl, nextOpenApiConfig, service);
    requiresSync = requiresSync
      || service.serviceSourceType !== nextConfig.serviceSourceType
      || service.serviceSourceDomain !== nextConfig.serviceSourceDomain
      || service.serviceSourcePort !== nextConfig.serviceSourcePort
      || service.serviceSourceProtocol !== nextConfig.serviceSourceProtocol;
    service.serviceSourceType = nextConfig.serviceSourceType;
    service.serviceSourceDomain = nextConfig.serviceSourceDomain;
    service.serviceSourcePort = nextConfig.serviceSourcePort;
    service.serviceSourceProtocol = nextConfig.serviceSourceProtocol;
  }

  if (
    input.gatewayDomain !== undefined
    || input.gatewayPath !== undefined
    || input.upstreamUrl !== undefined
    || input.higressMcpType !== undefined
  ) {
    const nextGateway = resolveGatewayConfigForMcpType(input, nextHigressMcpType, nextUpstreamUrl, service);
    await ensureGatewayRouteAvailable(nextGateway.gatewayDomain, nextGateway.gatewayPath, service._id);
    requiresSync = requiresSync
      || service.gatewayDomain !== nextGateway.gatewayDomain
      || service.gatewayPath !== nextGateway.gatewayPath;
    service.gatewayDomain = nextGateway.gatewayDomain;
    service.gatewayPath = nextGateway.gatewayPath;
  }

  if (nextHigressMcpType === 'DIRECT_ROUTE' && input.upstreamUrl !== undefined && String(input.upstreamUrl).trim()) {
    const upstreamUrl = normalizeUpstreamUrl(input.upstreamUrl);
    const encryptedUrl = encryptUpstreamUrl(upstreamUrl);
    service.upstreamUrlCiphertext = encryptedUrl.upstreamUrlCiphertext;
    service.upstreamUrlVersion = encryptedUrl.upstreamUrlVersion;
    requiresSync = true;
  }
  if (nextHigressMcpType !== 'DIRECT_ROUTE' && service.upstreamUrlCiphertext) {
    service.upstreamUrlCiphertext = '';
    service.upstreamUrlVersion = '';
  }

  if (requiresSync) {
    service.syncStatus = 'updating';
    service.syncMessage = 'Waiting for Higress sync';
  }

  await service.save();

  if (requiresSync) {
    await executeSync(service, operator, 'update');
  }

  return service;
}

async function deleteMcpService(serviceId, operator) {
  const service = await McpService.findById(serviceId);
  if (!service) {
    throw new McpDomainError('MCP service not found', 'NOT_FOUND', 404);
  }

  if (!canManageService(operator, service)) {
    throw new McpDomainError('No permission to manage this MCP service', 'FORBIDDEN', 403);
  }

  service.syncStatus = 'deleting';
  service.syncMessage = 'Deleting from Higress';
  await service.save();

  await deleteServiceFromHigress(service);
  await McpSyncRecord.deleteMany({ mcpServiceId: service._id });
  await McpService.deleteOne({ _id: service._id });

  return { id: String(service._id), serviceKey: service.serviceKey };
}
async function resyncMcpService(serviceId, operator) {
  const service = await McpService.findById(serviceId);
  if (!service) {
    throw new McpDomainError('MCP service not found', 'NOT_FOUND', 404);
  }

  if (!canManageService(operator, service)) {
    throw new McpDomainError('No permission to manage this MCP service', 'FORBIDDEN', 403);
  }

  service.syncStatus = service.syncStatus === 'active' ? 'updating' : 'creating';
  service.syncMessage = 'Manual resync requested';
  service.lastSyncRequestedAt = new Date();
  await service.save();

  await executeSync(service, operator, 'resync');
  return service;
}

async function getMyServices(query, operator) {
  const search = String(query.search || '').trim();
  const syncStatus = String(query.syncStatus || '').trim();
  const transport = String(query.transport || '').trim();
  const category = String(query.category || '').trim();
  const tag = String(query.tag || '').trim();

  const filters = {
    'owner.badge': operator.Badge
  };

  if (search) {
    filters.$or = [
      { displayName: { $regex: search, $options: 'i' } },
      { summary: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } },
      { serviceKey: { $regex: search, $options: 'i' } }
    ];
  }
  if (syncStatus) {
    filters.syncStatus = syncStatus;
  }
  if (transport) {
    filters.transport = transport;
  }
  if (category && category !== 'all') {
    filters.category = category;
  }
  if (tag) {
    filters.tags = tag;
  }

  const services = await McpService.find(filters).sort({ updatedAt: -1 }).lean();
  const favoriteContext = await buildFavoriteContext(services, operator);
  return services.map(service => buildListItem(service, favoriteContext, {
    canAccessClientConfig: true
  }));
}

async function getCatalog(query, operator) {
  const search = String(query.search || '').trim();
  const transport = String(query.transport || '').trim();
  const category = String(query.category || '').trim();
  const tag = String(query.tag || '').trim();
  const sortBy = String(query.sortBy || 'createdAt').trim();
  const baseSort = sortBy === 'hot'
    ? { updatedAt: -1 }
    : { [sortBy === 'displayName' ? 'displayName' : 'createdAt']: sortBy === 'displayName' ? 1 : -1 };
  const sort = {
    isPinned: -1,
    pinnedAt: -1,
    ...baseSort
  };

  const filters = buildVisibilityFilter(operator);

  if (search) {
    filters.$and = [{
      $or: [
        { displayName: { $regex: search, $options: 'i' } },
        { summary: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
        { serviceKey: { $regex: search, $options: 'i' } }
      ]
    }];
  }
  if (transport) {
    filters.transport = transport;
  }
  if (category && category !== 'all') {
    filters.category = category;
  }
  if (tag) {
    filters.tags = tag;
  }

  const services = await McpService.find(filters).sort(sort).lean();
  const favoriteContext = await buildFavoriteContext(services, operator);
  const items = services.map(service => buildListItem(service, favoriteContext, {
    canAccessClientConfig: canAccessClientConfig(operator, service)
  }));

  if (sortBy === 'hot') {
    return items.sort(compareMcpHotItems);
  }

  return items;
}

function compareMcpHotItems(a, b) {
  const pinnedDelta = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
  if (pinnedDelta) return pinnedDelta;

  if (a.isPinned && b.isPinned) {
    return new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime();
  }

  const favoriteDelta = Number(b.favoriteCount || b.collectCount || 0) - Number(a.favoriteCount || a.collectCount || 0);
  if (favoriteDelta) return favoriteDelta;

  const viewDelta = Number(b.viewCount || 0) - Number(a.viewCount || 0);
  if (viewDelta) return viewDelta;

  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
}

async function getCollectedMcpServices(query, operator) {
  const collectUser = await getCollectUser(operator);
  if (!collectUser) return [];

  const collects = await Collect.find({ userId: collectUser._id, appType: 'mcp' }).sort({ createTime: -1 }).lean();
  const ids = collects.map(item => item.appId).filter(Boolean);
  if (!ids.length) return [];

  const filters = {
    _id: { $in: ids },
    ...buildVisibilityFilter(operator)
  };

  const search = String(query.search || '').trim();
  const transport = String(query.transport || '').trim();
  const category = String(query.category || '').trim();
  const tag = String(query.tag || '').trim();

  if (search) {
    filters.$and = [{
      $or: [
        { displayName: { $regex: search, $options: 'i' } },
        { summary: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
        { serviceKey: { $regex: search, $options: 'i' } }
      ]
    }];
  }
  if (transport) {
    filters.transport = transport;
  }
  if (category && category !== 'all') {
    filters.category = category;
  }
  if (tag) {
    filters.tags = tag;
  }

  const services = await McpService.find(filters).lean();
  const byId = new Map(services.map(service => [String(service._id), service]));
  const ordered = ids.map(id => byId.get(String(id))).filter(Boolean);
  const favoriteContext = await buildFavoriteContext(ordered, operator);
  return ordered.map(service => buildListItem(service, favoriteContext, {
    canAccessClientConfig: canAccessClientConfig(operator, service)
  }));
}

async function toggleMcpFavorite(serviceId, operator) {
  const service = await McpService.findById(serviceId);
  if (!service) {
    throw new McpDomainError('MCP service not found', 'NOT_FOUND', 404);
  }
  if (!canViewService(operator, service)) {
    throw new McpDomainError('No permission to view this MCP service', 'FORBIDDEN', 403);
  }

  const collectUser = await getCollectUser(operator);
  if (!collectUser) {
    throw new McpDomainError('User not found for favorite operation', 'USER_NOT_FOUND', 404);
  }

  const existing = await Collect.findOne({ userId: collectUser._id, appId: service._id, appType: 'mcp' });
  let isCollected = false;
  if (existing) {
    await Collect.deleteOne({ _id: existing._id });
  } else {
    await Collect.create({ userId: collectUser._id, appId: service._id, appName: service.displayName, appType: 'mcp' });
    isCollected = true;
  }

  const favoriteCount = await Collect.countDocuments({ appId: service._id, appType: 'mcp' });
  return { id: String(service._id), serviceKey: service.serviceKey, isCollected, favoriteCount, collectCount: favoriteCount };
}

async function toggleMcpPinned(serviceId, input, operator) {
  if (!isAdmin(operator)) {
    throw new McpDomainError('No permission to pin this MCP service', 'FORBIDDEN', 403);
  }

  const service = await McpService.findById(serviceId);
  if (!service) {
    throw new McpDomainError('MCP service not found', 'NOT_FOUND', 404);
  }

  const isPinned = Boolean(input?.isPinned);
  service.isPinned = isPinned;
  service.pinnedAt = isPinned ? new Date() : null;
  await service.save();

  return {
    id: String(service._id),
    serviceKey: service.serviceKey,
    isPinned: service.isPinned,
    pinnedAt: service.pinnedAt
  };
}

async function getServiceDetail(serviceId, operator, { allowVisibleAccess = false, incrementView = false } = {}) {
  const service = await McpService.findById(serviceId);
  if (!service) {
    throw new McpDomainError('MCP service not found', 'NOT_FOUND', 404);
  }

  const canManage = canManageService(operator, service);
  const canView = canViewService(operator, service);

  if (!canManage && !canView) {
    throw new McpDomainError('No permission to view this MCP service', 'FORBIDDEN', 403);
  }

  if (incrementView) {
    service.viewCount = Number(service.viewCount || 0) + 1;
    await McpService.updateOne({ _id: service._id }, { $inc: { viewCount: 1 } });
  }

  const latestSyncRecord = await McpSyncRecord.findOne({ mcpServiceId: service._id }).sort({ createdAt: -1 }).lean();
  const favoriteContext = await buildFavoriteContext([service], operator);
  return buildDetailItem(service, latestSyncRecord, favoriteContext, {
    canAccessClientConfig: canAccessClientConfig(operator, service),
    canManageSourceConfig: canManage
  });
}

module.exports = {
  HigressClientError,
  McpDomainError,
  createMcpService,
  deleteMcpService,
  getCatalog,
  getCollectedMcpServices,
  getMyServices,
  getServiceDetail,
  previewMcpConnection,
  isAdmin,
  resyncMcpService,
  toggleMcpFavorite,
  toggleMcpPinned,
  updateMcpService,
  __test__: {
    executeSync,
    refreshToolSnapshot,
    buildDetailItem,
    buildVisibilityFilter,
    inferGatewayFromUpstreamUrl,
    previewMcpConnection,
    resolveGatewayConfig,
    buildSourceConfigResponse,
    normalizeOpenApiConfig,
    resolveServiceSourceConfigForMcpType,
    ensureGatewayRouteAvailable,
    ensureDirectRouteUpstreamUrl,
    canUseService
  }
};




