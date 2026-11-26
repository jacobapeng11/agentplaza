const axios = require('axios');

class McpToolDiscoveryError extends Error {
  constructor(message, detail = null) {
    super(message);
    this.name = 'McpToolDiscoveryError';
    this.code = 'MCP_TOOL_DISCOVERY_FAILED';
    this.detail = detail;
  }
}

function summarizeInputSchema(schema = {}) {
  const properties = schema && typeof schema === 'object' ? (schema.properties || {}) : {};
  const required = Array.isArray(schema && schema.required) ? schema.required : [];

  return Object.entries(properties).map(([name, config]) => {
    const type = String(config && config.type ? config.type : 'unknown');
    const requiredText = required.includes(name) ? 'required' : 'optional';
    return `${name}:${type}(${requiredText})`;
  });
}

function sanitizeMongoUnsafeKey(key = '') {
  return String(key)
    .replace(/\$/g, '__DOLLAR__')
    .replace(/\./g, '__DOT__');
}

function sanitizeMongoUnsafeKeys(value) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeMongoUnsafeKeys(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((result, [key, entryValue]) => {
    result[sanitizeMongoUnsafeKey(key)] = sanitizeMongoUnsafeKeys(entryValue);
    return result;
  }, {});
}

function parseJsonRpcPayload(data) {
  if (!data) return {};
  if (typeof data === 'object') return data;

  const text = String(data || '').trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    // Some Streamable HTTP servers, including FastGPT, return a single SSE
    // message for POST requests: event: message\ndata: {jsonrpc...}
  }

  const events = text.split(/\r?\n\r?\n/);
  for (const rawEvent of events) {
    const event = parseSseEvent(rawEvent);
    if (!event.data) continue;
    try {
      const payload = JSON.parse(event.data);
      if (payload && typeof payload === 'object') return payload;
    } catch {
      continue;
    }
  }

  return {};
}

async function discoverToolsFromUpstream(upstreamUrl, transport = 'streamable') {
  try {
    const response = await axios.post(
      upstreamUrl,
      {
        jsonrpc: '2.0',
        id: 'tool-discovery',
        method: 'tools/list',
        params: {}
      },
      {
        timeout: 15000,
        headers: {
          'content-type': 'application/json',
          accept: transport === 'sse' ? 'text/event-stream, application/json' : 'application/json, text/event-stream'
        }
      }
    );

    const payload = parseJsonRpcPayload(response?.data);
    if (payload?.error) {
      throw new McpToolDiscoveryError(payload.error.message || 'Tool discovery failed', payload.error);
    }
    const tools = Array.isArray(payload?.result?.tools) ? payload.result.tools : [];

    return {
      sourceUrl: upstreamUrl,
      transport,
      fetchedAt: new Date().toISOString(),
      toolCount: tools.length,
      tools: tools.map(tool => ({
        name: String(tool?.name || '').trim(),
        title: String(tool?.title || '').trim(),
        description: String(tool?.description || '').trim(),
        inputSchemaSummary: summarizeInputSchema(tool?.inputSchema || {}),
        rawInputSchema: sanitizeMongoUnsafeKeys(tool?.inputSchema || {})
      }))
    };
  } catch (error) {
    throw new McpToolDiscoveryError(error?.message || 'Tool discovery failed', error?.response?.data || null);
  }
}

function parseSseEvent(rawEvent) {
  const event = { event: 'message', data: '' };
  const dataLines = [];

  for (const line of String(rawEvent || '').split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separatorIndex = line.indexOf(':');
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    const rawValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') event.event = value || 'message';
    if (field === 'data') dataLines.push(value);
  }

  event.data = dataLines.join('\n');
  return event;
}

function resolveSseEndpoint(sseUrl, endpoint) {
  return new URL(String(endpoint || ''), sseUrl).toString();
}

function buildToolSnapshot(sourceUrl, transport, tools = []) {
  return {
    sourceUrl,
    transport,
    fetchedAt: new Date().toISOString(),
    toolCount: tools.length,
    tools: tools.map(tool => ({
      name: String(tool?.name || '').trim(),
      title: String(tool?.title || '').trim(),
      description: String(tool?.description || '').trim(),
      inputSchemaSummary: summarizeInputSchema(tool?.inputSchema || {}),
      rawInputSchema: sanitizeMongoUnsafeKeys(tool?.inputSchema || {})
    }))
  };
}

async function discoverToolsViaSse(sseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let stream = null;

  try {
    const response = await axios.get(sseUrl, {
      timeout: 15000,
      responseType: 'stream',
      signal: controller.signal,
      headers: {
        accept: 'text/event-stream'
      }
    });
    stream = response.data;

    let buffer = '';
    let endpointUrl = '';
    let toolsResult = null;

    for await (const chunk of stream) {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';

      for (const rawEvent of events) {
        const event = parseSseEvent(rawEvent);
        if (!event.data) continue;

        if (!endpointUrl && event.event === 'endpoint') {
          endpointUrl = resolveSseEndpoint(sseUrl, event.data);
          await axios.post(endpointUrl, {
            jsonrpc: '2.0',
            id: 'initialize',
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'agentplaza-tool-discovery', version: '1.0.0' }
            }
          }, {
            timeout: 10000,
            signal: controller.signal,
            headers: { 'content-type': 'application/json', accept: 'application/json' }
          });
          await axios.post(endpointUrl, {
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {}
          }, {
            timeout: 10000,
            signal: controller.signal,
            headers: { 'content-type': 'application/json', accept: 'application/json' }
          });
          await axios.post(endpointUrl, {
            jsonrpc: '2.0',
            id: 'tools-list',
            method: 'tools/list',
            params: {}
          }, {
            timeout: 10000,
            signal: controller.signal,
            headers: { 'content-type': 'application/json', accept: 'application/json' }
          });
          continue;
        }

        let payload = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          continue;
        }

        if (payload?.id === 'tools-list') {
          if (payload.error) {
            throw new McpToolDiscoveryError(payload.error.message || 'SSE tools/list failed', payload.error);
          }
          toolsResult = payload?.result || {};
          return buildToolSnapshot(sseUrl, 'sse', Array.isArray(toolsResult.tools) ? toolsResult.tools : []);
        }
      }
    }

    throw new McpToolDiscoveryError(endpointUrl ? 'SSE tools/list response not received' : 'SSE endpoint event not received');
  } catch (error) {
    if (error instanceof McpToolDiscoveryError) throw error;
    throw new McpToolDiscoveryError(error?.message || 'SSE tool discovery failed', error?.response?.data || null);
  } finally {
    clearTimeout(timeout);
    if (stream && typeof stream.destroy === 'function') {
      stream.destroy();
    }
  }
}

module.exports = {
  McpToolDiscoveryError,
  discoverToolsFromUpstream,
  discoverToolsViaSse,
  sanitizeMongoUnsafeKeys,
  summarizeInputSchema
};
