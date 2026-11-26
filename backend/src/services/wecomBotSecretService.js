const crypto = require('crypto');

const MASKED_SECRET_PLACEHOLDER = '********';
const SECRET_VERSION = 'v1';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * 企业微信 Bot Secret 服务错误。
 * 输入: 业务错误码、错误消息和可选 HTTP 状态码。
 * 输出: 带 code/statusCode 的 Error 实例，供路由或服务层统一转换响应。
 */
class WecomBotSecretServiceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'WecomBotSecretServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * 归一化加密密钥。
 * 输入: 环境变量或调用方传入的字符串密钥。
 * 输出: 32 字节 Buffer，用于 aes-256-gcm。
 */
function normalizeEncryptionKey(encryptionKey = process.env.WECOM_BOT_SECRET_ENCRYPTION_KEY) {
  const rawKey = String(encryptionKey || '');
  if (Buffer.byteLength(rawKey) < 32) {
    throw new WecomBotSecretServiceError(
      'ENCRYPTION_KEY_REQUIRED',
      'Configure WECOM_BOT_SECRET_ENCRYPTION_KEY with a randomly generated 32-byte secret',
      503
    );
  }
  if (/^[a-f0-9]{64}$/i.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }

  if (Buffer.byteLength(rawKey) === 32) {
    return Buffer.from(rawKey);
  }

  return crypto.createHash('sha256').update(String(rawKey)).digest();
}

/**
 * 加密敏感凭证值。
 * 输入: 明文凭证、可选加密密钥和字段名。
 * 输出: base64 编码的 aes-256-gcm 密文。
 */
function encryptCredentialValue(value, encryptionKey, { requiredCode, requiredMessage }) {
  if (!value || !String(value).trim()) {
    throw new WecomBotSecretServiceError(requiredCode, requiredMessage);
  }

  const key = normalizeEncryptionKey(encryptionKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([
    cipher.update(String(value), 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * 解密敏感凭证值。
 * 输入: base64 密文、版本、可选加密密钥和错误语义。
 * 输出: 明文凭证；密文缺失、版本不支持或解密失败时抛出业务错误。
 */
function decryptCredentialValue(ciphertext, version, encryptionKey, {
  requiredCode,
  requiredMessage,
  versionCode,
  versionMessage,
  decryptCode,
  decryptMessage
}) {
  if (!ciphertext) {
    throw new WecomBotSecretServiceError(requiredCode, requiredMessage);
  }

  if (version && version !== SECRET_VERSION) {
    throw new WecomBotSecretServiceError(versionCode, versionMessage);
  }

  try {
    const payload = Buffer.from(ciphertext, 'base64');
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', normalizeEncryptionKey(encryptionKey), iv, {
      authTagLength: AUTH_TAG_LENGTH
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    throw new WecomBotSecretServiceError(decryptCode, decryptMessage);
  }
}

/**
 * 加密企业微信 Bot Secret。
 * 输入: 明文 Secret 和可选加密密钥。
 * 输出: 包含 secretCiphertext/secretVersion 的持久化字段。
 */
function encryptSecret(secret, encryptionKey) {
  return {
    secretCiphertext: encryptCredentialValue(secret, encryptionKey, {
      requiredCode: 'SECRET_REQUIRED',
      requiredMessage: 'Secret is required'
    }),
    secretVersion: SECRET_VERSION
  };
}

/**
 * 解密企业微信 Bot Secret。
 * 输入: 含密文字段的对象和可选加密密钥。
 * 输出: 明文 Secret；密文缺失或版本不支持时抛出可诊断错误。
 */
function decryptSecret(secretRecord, encryptionKey) {
  return decryptCredentialValue(secretRecord?.secretCiphertext, secretRecord?.secretVersion, encryptionKey, {
    requiredCode: 'SECRET_REQUIRED',
    requiredMessage: 'Secret ciphertext is required',
    versionCode: 'SECRET_VERSION_UNSUPPORTED',
    versionMessage: 'Secret version is unsupported',
    decryptCode: 'SECRET_DECRYPT_FAILED',
    decryptMessage: 'Secret cannot be decrypted'
  });
}

/**
 * 加密 FastGPT API Key。
 * 输入: 明文 FastGPT API Key 和可选加密密钥。
 * 输出: 包含 fastgptApiKeyCiphertext/fastgptApiKeyVersion 的持久化字段。
 */
function encryptFastgptApiKey(apiKey, encryptionKey) {
  return {
    fastgptApiKeyCiphertext: encryptCredentialValue(apiKey, encryptionKey, {
      requiredCode: 'FASTGPT_API_KEY_REQUIRED',
      requiredMessage: 'FastGPT API Key is required'
    }),
    fastgptApiKeyVersion: SECRET_VERSION
  };
}

/**
 * 解密 FastGPT API Key。
 * 输入: 含 FastGPT API Key 密文字段的对象和可选加密密钥。
 * 输出: 明文 FastGPT API Key；密文缺失或版本不支持时抛出业务错误。
 */
function decryptFastgptApiKey(credentialRecord, encryptionKey) {
  return decryptCredentialValue(
    credentialRecord?.fastgptApiKeyCiphertext,
    credentialRecord?.fastgptApiKeyVersion,
    encryptionKey,
    {
      requiredCode: 'FASTGPT_API_KEY_REQUIRED',
      requiredMessage: 'FastGPT API Key ciphertext is required',
      versionCode: 'FASTGPT_API_KEY_VERSION_UNSUPPORTED',
      versionMessage: 'FastGPT API Key version is unsupported',
      decryptCode: 'FASTGPT_API_KEY_DECRYPT_FAILED',
      decryptMessage: 'FastGPT API Key cannot be decrypted'
    }
  );
}

/**
 * 根据保存请求解析 Secret 持久化字段。
 * 输入: 现有密文字段、keepExistingSecret 标记、新明文 Secret 和可选加密密钥。
 * 输出: 应写入数据库的密文字段；提交脱敏占位符或缺失 Secret 时抛出业务错误。
 */
function resolveSecretForSave({
  existingSecret,
  keepExistingSecret = false,
  secret = '',
  encryptionKey
} = {}) {
  if (keepExistingSecret) {
    if (!existingSecret?.secretCiphertext) {
      throw new WecomBotSecretServiceError('SECRET_REQUIRED', 'Existing Secret is required');
    }
    return {
      secretCiphertext: existingSecret.secretCiphertext,
      secretVersion: existingSecret.secretVersion || SECRET_VERSION
    };
  }

  if (secret === MASKED_SECRET_PLACEHOLDER) {
    throw new WecomBotSecretServiceError('MASKED_SECRET_REJECTED', 'Masked Secret placeholder cannot be saved');
  }

  return encryptSecret(secret, encryptionKey);
}

/**
 * 根据保存请求解析 FastGPT API Key 持久化字段。
 * 输入: 现有密文字段、keepExistingFastgptApiKey 标记、新明文 API Key 和可选加密密钥。
 * 输出: 应写入数据库的 FastGPT API Key 密文字段；提交脱敏占位符或保留缺失密文时抛出业务错误。
 */
function resolveFastgptApiKeyForSave({
  existingCredential,
  keepExistingFastgptApiKey = false,
  fastgptApiKey = '',
  encryptionKey
} = {}) {
  if (keepExistingFastgptApiKey) {
    if (!existingCredential?.fastgptApiKeyCiphertext) {
      throw new WecomBotSecretServiceError('FASTGPT_API_KEY_REQUIRED', 'Existing FastGPT API Key is required');
    }
    return {
      fastgptApiKeyCiphertext: existingCredential.fastgptApiKeyCiphertext,
      fastgptApiKeyVersion: existingCredential.fastgptApiKeyVersion || SECRET_VERSION
    };
  }

  if (fastgptApiKey === MASKED_SECRET_PLACEHOLDER) {
    throw new WecomBotSecretServiceError(
      'MASKED_FASTGPT_API_KEY_REJECTED',
      'Masked FastGPT API Key placeholder cannot be saved'
    );
  }

  return encryptFastgptApiKey(fastgptApiKey, encryptionKey);
}

/**
 * 生成 Secret 的安全响应字段。
 * 输入: 可能包含密文的绑定记录。
 * 输出: 仅包含是否已配置 Secret 和占位符的前端展示字段。
 */
function maskSecretForResponse(secretRecord) {
  if (!secretRecord?.secretCiphertext) {
    return { secretMasked: false };
  }

  return {
    secretMasked: true,
    secretPlaceholder: MASKED_SECRET_PLACEHOLDER
  };
}

/**
 * 生成 FastGPT API Key 的安全响应字段。
 * 输入: 可能包含 FastGPT API Key 密文的绑定记录。
 * 输出: 仅包含是否已配置 API Key 和占位符的前端展示字段。
 */
function maskFastgptApiKeyForResponse(credentialRecord) {
  if (!credentialRecord?.fastgptApiKeyCiphertext) {
    return { fastgptApiKeyMasked: false };
  }

  return {
    fastgptApiKeyMasked: true,
    fastgptApiKeyPlaceholder: MASKED_SECRET_PLACEHOLDER
  };
}

/**
 * 创建可注入配置的 Secret 服务实例。
 * 输入: 可选 encryptionKey，用于测试或不同部署密钥。
 * 输出: 绑定密钥后的 encrypt/decrypt/resolve/mask 方法集合。
 */
function createWecomBotSecretService({ encryptionKey } = {}) {
  return {
    encryptSecret: (secret) => encryptSecret(secret, encryptionKey),
    decryptSecret: (secretRecord) => decryptSecret(secretRecord, encryptionKey),
    encryptFastgptApiKey: (apiKey) => encryptFastgptApiKey(apiKey, encryptionKey),
    decryptFastgptApiKey: (credentialRecord) => decryptFastgptApiKey(credentialRecord, encryptionKey),
    resolveSecretForSave: (options) => resolveSecretForSave({ ...options, encryptionKey }),
    resolveFastgptApiKeyForSave: (options) => resolveFastgptApiKeyForSave({ ...options, encryptionKey }),
    maskSecretForResponse,
    maskFastgptApiKeyForResponse
  };
}

module.exports = {
  MASKED_SECRET_PLACEHOLDER,
  WecomBotSecretServiceError,
  createWecomBotSecretService,
  decryptSecret,
  decryptFastgptApiKey,
  encryptFastgptApiKey,
  encryptSecret,
  maskFastgptApiKeyForResponse,
  maskSecretForResponse,
  normalizeEncryptionKey,
  resolveFastgptApiKeyForSave,
  resolveSecretForSave
};
