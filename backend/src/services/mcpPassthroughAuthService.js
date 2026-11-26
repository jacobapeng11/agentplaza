const yaml = require('js-yaml');

const MANAGED_SCHEME_IDS = ['AgentPlazaClientAuth', 'AgentPlazaBackendAuth'];
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const PARAM_NAME_PATTERN = /^[A-Za-z0-9._~-]+$/;

class McpPassthroughAuthError extends Error {
  constructor(message, code = 'OPENAPI_AUTH_CONFIG_INVALID') {
    super(message);
    this.name = 'McpPassthroughAuthError';
    this.code = code;
    this.statusCode = 400;
  }
}

function normalizeLocation(value, fieldName) {
  const location = String(value || '').trim();
  if (!['header', 'query'].includes(location)) {
    throw new McpPassthroughAuthError(`${fieldName} must be header or query`);
  }
  return location;
}

function normalizeName(value, location, fieldName) {
  const name = String(value || '').trim();
  const valid = location === 'header' ? HEADER_NAME_PATTERN.test(name) : PARAM_NAME_PATTERN.test(name);
  if (!valid) throw new McpPassthroughAuthError(`${fieldName} is invalid`);
  return name;
}

function normalizeOpenApiAuthConfig(value = {}) {
  const enabled = Boolean(value.enabled);
  const credentialType = String(value.credentialType || 'bearer').trim();
  if (!['bearer', 'apiKey'].includes(credentialType)) {
    throw new McpPassthroughAuthError('credentialType must be bearer or apiKey');
  }
  if (!enabled) return { enabled: false, credentialType };

  const client = credentialType === 'bearer'
    ? { in: 'header', name: 'Authorization', scheme: 'bearer' }
    : (() => {
      const location = normalizeLocation(value.client?.in, 'client.in');
      return { in: location, name: normalizeName(value.client?.name, location, 'client.name') };
    })();
  const backendMode = credentialType === 'bearer' && value.backend?.scheme === 'bearer';
  const backend = backendMode
    ? { in: 'header', name: 'Authorization', scheme: 'bearer' }
    : (() => {
      const location = normalizeLocation(value.backend?.in, 'backend.in');
      return { in: location, name: normalizeName(value.backend?.name, location, 'backend.name') };
    })();
  const mode = value.applyTo?.mode === 'selected' ? 'selected' : 'all';
  const toolNames = mode === 'selected'
    ? [...new Set((Array.isArray(value.applyTo?.toolNames) ? value.applyTo.toolNames : []).map(String).map(item => item.trim()).filter(Boolean))]
    : [];
  if (mode === 'selected' && !toolNames.length) {
    throw new McpPassthroughAuthError('applyTo.toolNames is required for selected mode');
  }
  return { enabled, credentialType, client, backend, applyTo: { mode, toolNames } };
}

function buildScheme(endpoint, credentialType) {
  if (credentialType === 'bearer' && endpoint.scheme === 'bearer') {
    return { type: 'http', scheme: 'bearer' };
  }
  return { type: 'apiKey', in: endpoint.in, name: endpoint.name };
}

function isManagedSecurity(value) {
  return value && MANAGED_SCHEME_IDS.includes(value.id);
}

function mergePassthroughAuthentication(rawConfigurations, inputConfig) {
  const config = normalizeOpenApiAuthConfig(inputConfig);
  let document;
  try {
    document = yaml.safeLoad(String(rawConfigurations || ''));
  } catch (error) {
    throw new McpPassthroughAuthError(`Failed to parse MCP YAML: ${error.message}`, 'OPENAPI_AUTH_YAML_PARSE_FAILED');
  }
  if (!document || typeof document !== 'object' || !Array.isArray(document.tools)) {
    throw new McpPassthroughAuthError('MCP YAML must contain a tools array', 'OPENAPI_AUTH_YAML_PARSE_FAILED');
  }

  document.server = document.server && typeof document.server === 'object' ? document.server : {};
  const schemes = Array.isArray(document.server.securitySchemes) ? document.server.securitySchemes : [];
  document.server.securitySchemes = schemes.filter(item => !MANAGED_SCHEME_IDS.includes(item?.id));

  const selected = new Set(config.applyTo?.toolNames || []);
  const knownTools = new Set(document.tools.map(tool => String(tool?.name || '')));
  for (const name of selected) {
    if (!knownTools.has(name)) throw new McpPassthroughAuthError(`Tool not found: ${name}`, 'OPENAPI_AUTH_TOOL_NOT_FOUND');
  }

  for (const tool of document.tools) {
    if (!tool || typeof tool !== 'object') continue;
    const managed = isManagedSecurity(tool.security);
    const target = config.enabled && (config.applyTo.mode === 'all' || selected.has(String(tool.name || '')));
    if (target && tool.security && !managed) {
      throw new McpPassthroughAuthError(`Tool already has security configuration: ${tool.name}`, 'OPENAPI_AUTH_SECURITY_CONFLICT');
    }
    if (managed) delete tool.security;
    if (tool.requestTemplate && isManagedSecurity(tool.requestTemplate.security)) delete tool.requestTemplate.security;
    if (target) {
      tool.security = { id: MANAGED_SCHEME_IDS[0], passthrough: true };
      tool.requestTemplate = tool.requestTemplate && typeof tool.requestTemplate === 'object' ? tool.requestTemplate : {};
      tool.requestTemplate.security = { id: MANAGED_SCHEME_IDS[1] };
    }
  }

  if (config.enabled) {
    document.server.securitySchemes.push(
      { id: MANAGED_SCHEME_IDS[0], ...buildScheme(config.client, config.credentialType) },
      { id: MANAGED_SCHEME_IDS[1], ...buildScheme(config.backend, config.credentialType) }
    );
  }
  if (!document.server.securitySchemes.length) delete document.server.securitySchemes;
  return yaml.safeDump(document, { noRefs: true, lineWidth: -1 });
}

module.exports = { McpPassthroughAuthError, mergePassthroughAuthentication, normalizeOpenApiAuthConfig };
