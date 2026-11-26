const logger = require('../utils/logger');
const axios = require('axios');
const { mergePassthroughAuthentication } = require('./mcpPassthroughAuthService');

class HigressClientError extends Error {
  constructor(message, code = 'HIGRESS_REQUEST_FAILED', statusCode = 502, detail = null) {
    super(message);
    this.name = 'HigressClientError';
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function parseDomains(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function stripPortFromHost(value) {
  const normalized = String(value || '').trim();
  const match = normalized.match(/^([^:]+):(\d+)$/);
  return match ? match[1] : normalized;
}

function withPortForStaticHost(value, port) {
  const normalized = String(value || '').trim();
  if (!normalized || /:\d+$/.test(normalized)) {
    return normalized;
  }
  if (normalized.includes(':') && !normalized.startsWith('[')) {
    return `[${normalized}]:${port}`;
  }
  return `${normalized}:${port}`;
}

function normalizeServiceSourceDomainForHigress(service) {
  if (service.serviceSourceType === 'static') {
    return withPortForStaticHost(service.serviceSourceDomain, service.serviceSourcePort);
  }
  return stripPortFromHost(service.serviceSourceDomain);
}

function unwrapBody(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

function resolveErrorMessage(error) {
  const body = error.response?.data;
  return body?.message || body?.errorMsg || error.message;
}

function normalizeStepDetail(detail = {}) {
  return Object.fromEntries(
    Object.entries(detail).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

async function runHigressStep(step, detail, operation, code = 'HIGRESS_REQUEST_FAILED') {
  try {
    return await operation();
  } catch (error) {
    const statusCode = error.statusCode || error.response?.status || 502;
    const originalDetail = error.detail || error.response?.data || null;
    throw new HigressClientError(
      `${step} failed: ${resolveErrorMessage(error)}`,
      error.code || code,
      statusCode,
      {
        ...normalizeStepDetail(detail),
        step,
        originalError: originalDetail
      }
    );
  }
}

function buildGatewayAccessUrl(service, transport) {
  const gatewayBaseUrl = normalizeBaseUrl(
    process.env.MCP_GATEWAY_BASE_URL || process.env.HIGRESS_GATEWAY_BASE_URL || ''
  );
  const fallbackBaseUrl = service.gatewayDomain ? `https://${service.gatewayDomain}` : '';
  const baseUrl = gatewayBaseUrl || fallbackBaseUrl;

  if (!baseUrl || !service.higressMcpServerName) {
    return '';
  }

  if (transport === 'sse') {
    return `${baseUrl}/mcp-servers/${service.higressMcpServerName}/sse`;
  }

  return `${baseUrl}/mcp-servers/${service.higressMcpServerName}`;
}

function buildEffectiveAccessUrl(service, upstreamUrl) {
  if (upstreamUrl) {
    return upstreamUrl;
  }

  return buildGatewayAccessUrl(service, service.transport);
}

function createHttpClient() {
  const baseURL = normalizeBaseUrl(process.env.HIGRESS_CONSOLE_BASE_URL);

  if (!baseURL) {
    throw new HigressClientError(
      'HIGRESS_CONSOLE_BASE_URL is not configured',
      'HIGRESS_CONFIG_MISSING',
      500
    );
  }

  const headers = {};
  const bearerToken = String(process.env.HIGRESS_CONSOLE_BEARER_TOKEN || '').trim();

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const username = String(process.env.HIGRESS_CONSOLE_USERNAME || '').trim();
  const password = String(process.env.HIGRESS_CONSOLE_PASSWORD || '').trim();

  return axios.create({
    baseURL,
    timeout: 20000,
    headers,
    auth: username && password ? { username, password } : undefined
  });
}

function buildServiceSourcePayload(service) {
  const higressDomain = normalizeServiceSourceDomainForHigress(service);
  const higressPort = String(service.serviceSourcePort);
  const payload = {
    name: service.higressServiceSourceName,
    type: service.serviceSourceType,
    domain: higressDomain,
    port: higressPort,
    proxyName: '',
    domainForEdit: higressDomain
  };

  if (service.serviceSourceProtocol) {
    payload.protocol = service.serviceSourceProtocol;
  }

  return payload;
}

function buildUpstreamServiceName(service) {
  return `${service.higressServiceSourceName}.${service.serviceSourceType}`;
}

function buildCommonMcpServerPayload(service) {
  return {
    name: service.higressMcpServerName,
    description: service.description || service.summary || service.displayName,
    domains: parseDomains(service.gatewayDomain),
    services: [{
      name: buildUpstreamServiceName(service),
      port: String(service.serviceSourcePort),
      version: '1.0',
      weight: 100
    }],
    consumerAuthInfo: {
      type: 'key-auth',
      allowedConsumers: []
    }
  };
}

function normalizeHigressMcpType(value) {
  return String(value || 'DIRECT_ROUTE').trim() || 'DIRECT_ROUTE';
}

function buildMcpServerPayload(service) {
  const type = normalizeHigressMcpType(service.higressMcpType);
  const commonPayload = buildCommonMcpServerPayload(service);

  if (type === 'OPEN_API') {
    return {
      ...commonPayload,
      consumerAuthInfo: {
        ...commonPayload.consumerAuthInfo,
        enable: false
      },
      type: 'OPEN_API',
      rawConfigurations: service.openApiRawConfigurations || '',
      mcpServerName: service.higressMcpServerName
    };
  }

  return {
    ...commonPayload,
    type: 'DIRECT_ROUTE',
    directRouteConfig: {
      path: service.gatewayPath,
      transportType: service.transport
    }
  };
}

function throwRequestError(error) {
  const status = error.response?.status;
  const detail = error.response?.data || null;
  throw new HigressClientError(resolveErrorMessage(error), 'HIGRESS_REQUEST_FAILED', status || 502, detail);
}

async function fetchServiceSourceVersion(client, name) {
  const response = await client.get(`/v1/service-sources/${encodeURIComponent(name)}`);
  const body = unwrapBody(response.data);
  return body?.version || '';
}

async function upsertServiceSource(service) {
  const client = createHttpClient();
  const payload = buildServiceSourcePayload(service);

  try {
    const response = await client.post('/v1/service-sources', payload);
    return unwrapBody(response.data);
  } catch (error) {
    if (error.response?.status !== 409) {
      throwRequestError(error);
    }
  }

  try {
    const version = await fetchServiceSourceVersion(client, service.higressServiceSourceName);
    const response = await client.put(
      `/v1/service-sources/${encodeURIComponent(service.higressServiceSourceName)}`,
      { ...payload, version }
    );
    return unwrapBody(response.data);
  } catch (error) {
    throwRequestError(error);
  }
}

async function upsertMcpServer(service) {
  const client = createHttpClient();
  const serviceForPayload = await resolveOpenApiRawConfigurations(service, client);
  const rawConfigurations = mergePassthroughAuthentication(
    serviceForPayload.openApiRawConfigurations,
    serviceForPayload.openApiAuthConfig || { enabled: false }
  );
  const localPayload = buildMcpServerPayload({ ...serviceForPayload, openApiRawConfigurations: rawConfigurations });
  let payload = localPayload;
  if (service.lastSyncedAt) {
    try {
      const response = await client.get(`/v1/mcpServer/${encodeURIComponent(service.higressMcpServerName)}`);
      const remote = unwrapBody(response.data);
      if (remote && typeof remote === 'object') payload = { ...remote, ...localPayload, rawConfigurations };
    } catch (error) {
      if (error.response?.status !== 404) throwRequestError(error);
    }
  }

  logger.info('[mcp] upsert MCP server', { name: service.higressMcpServerName, type: payload.type });

  try {
    const response = await client.put('/v1/mcpServer', payload);
    return {
      data: unwrapBody(response.data),
      openApiRawConfigurations: rawConfigurations,
    };
  } catch (error) {
    throwRequestError(error);
  }
}

function buildRouteName(service) {
  return service.higressRouteName || `mcp-route-${service.serviceKey || service.higressMcpServerName || service.higressServiceSourceName}`;
}

function normalizeRoutePath(value) {
  const normalized = String(value || '').trim();
  return normalized.startsWith('/') ? normalized : `/${normalized || 'mcp'}`;
}

function buildRouteAccessUrl(service) {
  const gatewayBaseUrl = normalizeBaseUrl(
    process.env.MCP_GATEWAY_BASE_URL || process.env.HIGRESS_GATEWAY_BASE_URL || ''
  );
  const fallbackBaseUrl = service.gatewayDomain ? `https://${service.gatewayDomain}` : '';
  const baseUrl = gatewayBaseUrl || fallbackBaseUrl;
  return baseUrl ? `${baseUrl}${normalizeRoutePath(service.gatewayPath)}` : '';
}

function normalizeHeaderStage(stage = {}) {
  const normalizeHeaders = items => Array.isArray(items)
    ? items
      .map(item => ({ key: String(item?.key || '').trim(), value: String(item?.value || '') }))
      .filter(item => item.key)
    : [];
  const normalizeRemove = items => Array.isArray(items)
    ? items.map(item => String(item || '').trim()).filter(Boolean)
    : [];

  return {
    add: normalizeHeaders(stage.add),
    set: normalizeHeaders(stage.set),
    remove: normalizeRemove(stage.remove)
  };
}

function normalizeRoutePluginConfig(config = {}) {
  const rewrite = config.rewrite && typeof config.rewrite === 'object' ? config.rewrite : {};
  const headerModify = config.headerModify && typeof config.headerModify === 'object' ? config.headerModify : {};
  const keyAuth = config.keyAuth && typeof config.keyAuth === 'object' ? config.keyAuth : {};
  const transformer = config.transformer && typeof config.transformer === 'object' ? config.transformer : {};

  return {
    rewrite: {
      enabled: Boolean(rewrite.enabled),
      path: String(rewrite.path || '').trim(),
      host: String(rewrite.host || '').trim()
    },
    headerModify: {
      enabled: Boolean(headerModify.enabled),
      request: normalizeHeaderStage(headerModify.request),
      response: normalizeHeaderStage(headerModify.response)
    },
    keyAuth: {
      enabled: Boolean(keyAuth.enabled),
      allowedCredentialTypes: Array.isArray(keyAuth.allowedCredentialTypes) && keyAuth.allowedCredentialTypes.length
        ? keyAuth.allowedCredentialTypes.map(item => String(item || '').trim()).filter(Boolean)
        : ['key-auth'],
      allowedConsumers: Array.isArray(keyAuth.allowedConsumers)
        ? keyAuth.allowedConsumers.map(item => String(item || '').trim()).filter(Boolean)
        : [],
      rawConfigurations: String(keyAuth.rawConfigurations || '').trim()
    },
    transformer: {
      enabled: Boolean(transformer.enabled),
      rawConfigurations: String(transformer.rawConfigurations || '').trim()
    }
  };
}

function getIndentWidth(value) {
  return (value.match(/^\s*/) || [''])[0].length;
}

function normalizeYamlBlockScalarRuleLines(lines) {
  const nonEmptyLines = lines.filter(line => line.trim());
  const minIndent = nonEmptyLines.length
    ? Math.min(...nonEmptyLines.map(getIndentWidth))
    : 0;

  return lines.map(line => (line.trim() ? line.slice(minIndent) : ''));
}

function normalizeTransformerRawConfigurations(rawConfigurations = '') {
  const raw = String(rawConfigurations || '');
  if (!/^\s*(reqRules|respRules):\s*[|>]-?\s*$/m.test(raw)) {
    return raw;
  }

  const lines = raw.split(/\r?\n/);
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)(reqRules|respRules):\s*[|>]-?\s*$/);

    if (!match) {
      output.push(line);
      continue;
    }

    const parentIndent = match[1] || '';
    const parentIndentWidth = parentIndent.length;
    const blockLines = [];
    let nextIndex = index + 1;

    while (nextIndex < lines.length) {
      const nextLine = lines[nextIndex];
      if (nextLine.trim() && getIndentWidth(nextLine) <= parentIndentWidth) {
        break;
      }
      blockLines.push(nextLine);
      nextIndex += 1;
    }

    output.push(`${parentIndent}${match[2]}:`);
    output.push(...normalizeYamlBlockScalarRuleLines(blockLines));
    index = nextIndex - 1;
  }

  return output.join('\n');
}

function buildRoutePayload(service) {
  const routePluginConfig = normalizeRoutePluginConfig(service.routePluginConfig);
  const payload = {
    name: buildRouteName(service),
    domains: parseDomains(service.gatewayDomain),
    path: {
      matchType: 'PRE',
      matchValue: normalizeRoutePath(service.gatewayPath)
    },
    services: [{
      name: buildUpstreamServiceName(service),
      port: Number(service.serviceSourcePort),
      version: '1.0',
      weight: 100
    }]
  };

  if (routePluginConfig.rewrite.enabled) {
    payload.rewrite = {
      enabled: true,
      ...(routePluginConfig.rewrite.path ? { path: routePluginConfig.rewrite.path } : {}),
      ...(routePluginConfig.rewrite.host ? { host: routePluginConfig.rewrite.host } : {})
    };
  }

  if (routePluginConfig.headerModify.enabled) {
    payload.headerControl = {
      enabled: true,
      request: routePluginConfig.headerModify.request,
      response: routePluginConfig.headerModify.response
    };
  }

  if (routePluginConfig.keyAuth.enabled) {
    payload.authConfig = {
      enabled: true,
      allowedCredentialTypes: routePluginConfig.keyAuth.allowedCredentialTypes,
      allowedConsumers: routePluginConfig.keyAuth.allowedConsumers
    };
  }

  return payload;
}

function buildRoutePluginInstancePayload(service, pluginName, rawConfigurations) {
  const routeName = buildRouteName(service);
  const normalizedRawConfigurations = pluginName === 'transformer'
    ? normalizeTransformerRawConfigurations(rawConfigurations)
    : (rawConfigurations || '');
  return {
    version: null,
    scope: 'ROUTE',
    target: routeName,
    pluginVersion: null,
    internal: false,
    pluginName,
    enabled: true,
    targets: { ROUTE: routeName },
    rawConfigurations: normalizedRawConfigurations
  };
}
async function fetchRoute(client, name) {
  const response = await client.get(`/v1/routes/${encodeURIComponent(name)}`);
  return unwrapBody(response.data);
}

async function fetchRouteVersion(client, name) {
  const body = await fetchRoute(client, name);
  return body?.version || body?.data?.version || '';
}

async function upsertRoute(service) {
  const client = createHttpClient();
  const routeName = buildRouteName(service);
  const payload = buildRoutePayload(service);

  try {
    const response = await client.post('/v1/routes', payload);
    return unwrapBody(response.data);
  } catch (error) {
    if (error.response?.status !== 409) {
      throwRequestError(error);
    }
  }

  try {
    const version = await fetchRouteVersion(client, routeName);
    const response = await client.put(`/v1/routes/${encodeURIComponent(routeName)}`, { ...payload, version });
    return unwrapBody(response.data);
  } catch (error) {
    throwRequestError(error);
  }
}

async function putRoutePluginInstance(client, routeName, pluginName, rawConfigurations) {
  const payload = buildRoutePluginInstancePayload({ higressRouteName: routeName }, pluginName, rawConfigurations);
  logger.debug(`[DEBUG] Putting plugin ${pluginName} to route ${routeName}:`, JSON.stringify(payload, null, 2));
  const response = await client.put(
    `/v1/routes/${encodeURIComponent(routeName)}/plugin-instances/${encodeURIComponent(pluginName)}`,
    payload
  );
  return unwrapBody(response.data);
}

async function deleteRoutePluginInstanceIgnoringNotFound(client, routeName, pluginName) {
  try {
    const response = await client.delete(`/v1/routes/${encodeURIComponent(routeName)}/plugin-instances/${encodeURIComponent(pluginName)}`);
    return unwrapBody(response.data);
  } catch (error) {
    if (error.response?.status === 404) return null;
    throwRequestError(error);
  }
}

async function syncRoutePlugins(service) {
  const client = createHttpClient();
  const routeName = buildRouteName(service);
  const config = normalizeRoutePluginConfig(service.routePluginConfig);
  const results = {};

  if (config.keyAuth.enabled && config.keyAuth.rawConfigurations) {
    results.keyAuth = await putRoutePluginInstance(client, routeName, 'key-auth', config.keyAuth.rawConfigurations);
  } else {
    results.keyAuth = await deleteRoutePluginInstanceIgnoringNotFound(client, routeName, 'key-auth');
  }

  if (config.transformer.enabled && config.transformer.rawConfigurations) {
    results.transformer = await putRoutePluginInstance(client, routeName, 'transformer', config.transformer.rawConfigurations);
  } else {
    results.transformer = await deleteRoutePluginInstanceIgnoringNotFound(client, routeName, 'transformer');
  }

  return results;
}

async function syncDirectRouteToHigress(service) {
  const client = createHttpClient();
  const routeName = buildRouteName(service);
  const serviceSourceName = service.higressServiceSourceName;
  const stepContext = {
    routeName,
    serviceSourceName,
    gatewayPath: normalizeRoutePath(service.gatewayPath),
    gatewayDomain: service.gatewayDomain
  };

  const serviceSource = await runHigressStep(
    'upsert service source',
    stepContext,
    () => upsertServiceSource(service),
    'HIGRESS_SERVICE_SOURCE_SYNC_FAILED'
  );
  const route = await runHigressStep(
    'upsert route',
    stepContext,
    () => upsertRoute(service),
    'HIGRESS_ROUTE_SYNC_FAILED'
  );
  const verifiedRoute = await runHigressStep(
    'verify route',
    stepContext,
    () => fetchRoute(client, routeName),
    'HIGRESS_ROUTE_VERIFY_FAILED'
  );
  const plugins = await runHigressStep(
    'sync route plugins',
    stepContext,
    () => syncRoutePlugins(service),
    'HIGRESS_ROUTE_PLUGIN_SYNC_FAILED'
  );

  const gatewayAccessUrl = buildRouteAccessUrl(service);
  return {
    serviceSource,
    route: verifiedRoute || route,
    plugins,
    gatewayAccessUrl,
    debugGatewayAccessUrl: gatewayAccessUrl
  };
}
async function fetchOpenApiContent(url, httpClient = axios) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch (error) {
    throw new HigressClientError('OpenAPI URL is invalid', 'OPENAPI_FETCH_FAILED', 400);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HigressClientError('OpenAPI URL must use http or https', 'OPENAPI_FETCH_FAILED', 400);
  }

  try {
    const response = await httpClient.get(parsed.toString(), {
      responseType: 'text',
      timeout: Number(process.env.OPENAPI_FETCH_TIMEOUT_MS || 10000),
      maxContentLength: Number(process.env.OPENAPI_FETCH_MAX_BYTES || 1024 * 1024)
    });
    const content = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data);
    if (!content.trim()) {
      throw new HigressClientError('OpenAPI URL returned empty content', 'OPENAPI_FETCH_FAILED', 400);
    }
    return content;
  } catch (error) {
    if (error instanceof HigressClientError) {
      throw error;
    }
    throw new HigressClientError(resolveErrorMessage(error), 'OPENAPI_FETCH_FAILED', error.response?.status || 502, error.response?.data || null);
  }
}

async function resolveOpenApiRawConfigurations(service, client) {
  if (normalizeHigressMcpType(service.higressMcpType) !== 'OPEN_API') {
    return service;
  }

  if (service.openApiRawConfigurations) {
    return service;
  }

  const content = service.openApiContent || (
    service.openApiUrl ? await fetchOpenApiContent(service.openApiUrl) : ''
  );

  if (!content.trim()) {
    throw new HigressClientError('OpenAPI content is required', 'OPENAPI_CONVERT_FAILED', 400);
  }

  try {
    const response = await client.post('/v1/mcpServer/swaggerToMcpConfig', { content });
    return {
      ...service,
      openApiRawConfigurations: unwrapBody(response.data)
    };
  } catch (error) {
    throw new HigressClientError(resolveErrorMessage(error), 'OPENAPI_CONVERT_FAILED', error.response?.status || 502, error.response?.data || null);
  }
}

async function deleteIgnoringNotFound(client, url) {
  try {
    const response = await client.delete(url);
    return unwrapBody(response.data);
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throwRequestError(error);
  }
}

async function deleteServiceFromHigress(service) {
  const client = createHttpClient();
  const type = normalizeHigressMcpType(service.higressMcpType);

  if (type === 'DIRECT_ROUTE') {
    const route = await deleteIgnoringNotFound(
      client,
      `/v1/routes/${encodeURIComponent(buildRouteName(service))}`
    );
    const serviceSource = await deleteIgnoringNotFound(
      client,
      `/v1/service-sources/${encodeURIComponent(service.higressServiceSourceName)}`
    );
    return { route, serviceSource };
  }

  const mcpServer = await deleteIgnoringNotFound(
    client,
    `/v1/mcpServer/${encodeURIComponent(service.higressMcpServerName)}`
  );
  const serviceSource = await deleteIgnoringNotFound(
    client,
    `/v1/service-sources/${encodeURIComponent(service.higressServiceSourceName)}`
  );

  return { mcpServer, serviceSource };
}
async function syncServiceToHigress(service, upstreamUrl = '') {
  const type = normalizeHigressMcpType(service.higressMcpType);

  if (type === 'DIRECT_ROUTE') {
    return syncDirectRouteToHigress(service);
  }

  const serviceSource = await upsertServiceSource(service);
  const mcpServerResult = await upsertMcpServer(service);

  return {
    serviceSource,
    mcpServer: mcpServerResult.data,
    openApiRawConfigurations: mcpServerResult.openApiRawConfigurations || '',
    gatewayAccessUrl: buildGatewayAccessUrl(service, service.transport),
    debugGatewayAccessUrl: buildGatewayAccessUrl(service, service.transport)
  };
}

module.exports = {
  HigressClientError,
  buildGatewayAccessUrl,
  buildRouteAccessUrl,
  deleteServiceFromHigress,
  syncServiceToHigress,
  __test__: {
    buildMcpServerPayload,
    buildRoutePayload,
    normalizeRoutePluginConfig,
    normalizeTransformerRawConfigurations,
    fetchOpenApiContent,
    resolveOpenApiRawConfigurations
  }
};


