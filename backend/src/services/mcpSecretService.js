const {
  MASKED_SECRET_PLACEHOLDER,
  WecomBotSecretServiceError,
  encryptSecret,
  decryptSecret,
  maskSecretForResponse
} = require('./wecomBotSecretService');

function encryptUpstreamUrl(upstreamUrl, encryptionKey) {
  const encrypted = encryptSecret(upstreamUrl, encryptionKey);
  return {
    upstreamUrlCiphertext: encrypted.secretCiphertext,
    upstreamUrlVersion: encrypted.secretVersion
  };
}

function encryptJsonSecret(value, encryptionKey) {
  const encrypted = encryptSecret(JSON.stringify(value || {}), encryptionKey);
  return {
    secretCiphertext: encrypted.secretCiphertext,
    secretVersion: encrypted.secretVersion
  };
}

function decryptJsonSecret(secret, encryptionKey) {
  const plaintext = decryptSecret(secret, encryptionKey);
  if (!plaintext) return {};

  try {
    return JSON.parse(plaintext);
  } catch (error) {
    throw new WecomBotSecretServiceError('Failed to parse encrypted MCP config');
  }
}

function encryptRoutePluginConfig(config, encryptionKey) {
  const encrypted = encryptJsonSecret(config, encryptionKey);
  return {
    routePluginConfigCiphertext: encrypted.secretCiphertext,
    routePluginConfigVersion: encrypted.secretVersion
  };
}

function decryptRoutePluginConfig(service, encryptionKey) {
  return decryptJsonSecret({
    secretCiphertext: service?.routePluginConfigCiphertext,
    secretVersion: service?.routePluginConfigVersion
  }, encryptionKey);
}

function encryptOpenApiAuthConfig(config, encryptionKey) {
  const encrypted = encryptJsonSecret(config, encryptionKey);
  return { openApiAuthConfigCiphertext: encrypted.secretCiphertext, openApiAuthConfigVersion: encrypted.secretVersion };
}

function decryptOpenApiAuthConfig(service, encryptionKey) {
  return decryptJsonSecret({
    secretCiphertext: service?.openApiAuthConfigCiphertext,
    secretVersion: service?.openApiAuthConfigVersion
  }, encryptionKey);
}

function encryptOpenApiConfig(config, encryptionKey) {
  const content = config?.openApiContent ? encryptSecret(config.openApiContent, encryptionKey) : null;
  const url = config?.openApiUrl ? encryptSecret(config.openApiUrl, encryptionKey) : null;
  const raw = config?.openApiRawConfigurations ? encryptSecret(config.openApiRawConfigurations, encryptionKey) : null;

  return {
    ...(content ? {
      openApiContentCiphertext: content.secretCiphertext,
      openApiContentVersion: content.secretVersion
    } : {}),
    ...(url ? {
      openApiUrlCiphertext: url.secretCiphertext,
      openApiUrlVersion: url.secretVersion
    } : {}),
    ...(raw ? {
      openApiRawConfigCiphertext: raw.secretCiphertext,
      openApiRawConfigVersion: raw.secretVersion
    } : {})
  };
}

function decryptOpenApiConfig(service, encryptionKey) {
  return {
    openApiContent: service?.openApiContentCiphertext
      ? decryptSecret({
        secretCiphertext: service.openApiContentCiphertext,
        secretVersion: service.openApiContentVersion
      }, encryptionKey)
      : '',
    openApiUrl: service?.openApiUrlCiphertext
      ? decryptSecret({
        secretCiphertext: service.openApiUrlCiphertext,
        secretVersion: service.openApiUrlVersion
      }, encryptionKey)
      : '',
    openApiRawConfigurations: service?.openApiRawConfigCiphertext
      ? decryptSecret({
        secretCiphertext: service.openApiRawConfigCiphertext,
        secretVersion: service.openApiRawConfigVersion
      }, encryptionKey)
      : ''
  };
}

function decryptUpstreamUrl(service, encryptionKey) {
  return decryptSecret({
    secretCiphertext: service?.upstreamUrlCiphertext,
    secretVersion: service?.upstreamUrlVersion
  }, encryptionKey);
}

function maskUpstreamUrl(service) {
  const masked = maskSecretForResponse({
    secretCiphertext: service?.upstreamUrlCiphertext
  });

  if (!masked.secretMasked) {
    return {
      upstreamUrlMasked: false,
      upstreamUrlPlaceholder: ''
    };
  }

  return {
    upstreamUrlMasked: true,
    upstreamUrlPlaceholder: MASKED_SECRET_PLACEHOLDER
  };
}

module.exports = {
  MASKED_SECRET_PLACEHOLDER,
  McpSecretServiceError: WecomBotSecretServiceError,
  decryptUpstreamUrl,
  decryptOpenApiConfig,
  decryptOpenApiAuthConfig,
  decryptRoutePluginConfig,
  encryptOpenApiConfig,
  encryptOpenApiAuthConfig,
  encryptRoutePluginConfig,
  encryptUpstreamUrl,
  maskUpstreamUrl
};
