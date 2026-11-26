const WecomBotBinding = require('../models/WecomBotBinding');
const WecomBotWorkerStatus = require('../models/WecomBotWorkerStatus');
const { WecomAibotClient } = require('./wecomAibotClient');
const { FastgptBotAdapter } = require('./fastgptBotAdapter');
const { createFastgptOpenApiKeyService } = require('./fastgptOpenApiKeyService');
const { resolveBindableFastgptApp } = require('./wecomBotAppResolver');
const { createWecomBotSecretService } = require('./wecomBotSecretService');
const { createWecomBotWorkerScheduler } = require('./wecomBotWorkerScheduler');
const { getDefaultFastgptApiBaseUrl } = require('../config/fastgpt');

const DEFAULT_FASTGPT_API_BASE_URL = getDefaultFastgptApiBaseUrl();

const DEFAULT_CONFIG = {
  enabled: false,
  fastgptApiBaseUrl: DEFAULT_FASTGPT_API_BASE_URL,
  botPrefix: '',
  showToolMessages: false,
  showReasoning: false,
  privateChatPolicy: 'reply_all',
  groupChatMentionEnabled: true
};

const VALID_PRIVATE_CHAT_POLICIES = ['reply_all', 'disabled'];
const TEST_CONNECTION_BLOCKING_STATUSES = new Set(['connected', 'reconnecting']);
const STALE_OPENAPI_KEY_ERROR_CODES = new Set([
  'FASTGPT_OPENAPI_KEY_NOT_FOUND',
  'FASTGPT_OPENAPI_KEY_APP_MISMATCH'
]);

/**
 * 企业微信 Bot 配置服务错误。
 * 输入: 业务错误码、错误消息和可选 HTTP 状态码。
 * 输出: 带 code/statusCode 的 Error 实例，供路由转换为统一响应。
 */
class WecomBotConfigServiceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'WecomBotConfigServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * 执行 Mongoose 查询或普通 Promise。
 * 输入: Mongoose Query、thenable 或普通值。
 * 输出: 查询解析后的文档对象。
 */
async function executeQuery(query) {
  if (query && typeof query.exec === 'function') {
    return query.exec();
  }

  return query;
}

/**
 * 转换 Mongoose 文档为普通对象。
 * 输入: Mongoose 文档或普通对象。
 * 输出: 可安全序列化和比较的普通对象。
 */
function toPlainDocument(document) {
  if (!document) {
    return null;
  }

  if (typeof document.toObject === 'function') {
    return document.toObject();
  }

  return document;
}

/**
 * 净化可返回给前端的错误摘要。
 * 输入: 任意错误或字符串，以及本次请求中已知的敏感值列表。
 * 输出: 截断且不包含 Secret、API Key、Token 或 raw payload 明显片段的摘要。
 */
function sanitizeSensitiveSummary(value, sensitiveValues = []) {
  let summary = String(value?.message || value || '');
  Array.from(new Set(sensitiveValues.map((sensitiveValue) => String(sensitiveValue || '').trim()).filter(Boolean)))
    .sort((left, right) => right.length - left.length)
    .forEach((sensitiveValue) => {
      summary = summary.split(sensitiveValue).join('[REDACTED]');
    });

  return summary
    .replace(/(api[_-]?key|secret|token)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]')
    .replace(/(Bearer\s+)[^\s,]+/gi, '$1[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-[REDACTED]')
    .replace(/raw payload/gi, 'payload')
    .slice(0, 500);
}

/**
 * 规范化并校验 Bot ID。
 * 输入: 请求体中的 botId。
 * 输出: 去除首尾空白后的 Bot ID；非法时抛出业务错误。
 */
function normalizeBotId(botId) {
  const normalized = String(botId || '').trim();
  if (!normalized) {
    throw new WecomBotConfigServiceError('BOT_ID_REQUIRED', 'Bot ID is required');
  }

  if (normalized.length > 128) {
    throw new WecomBotConfigServiceError('BOT_ID_INVALID', 'Bot ID is too long');
  }

  return normalized;
}

/**
 * 规范化并校验 Bot Prefix。
 * 输入: 请求体中的 botPrefix。
 * 输出: 去除首尾空白后的群聊预留 Prefix；超长时抛出业务错误。
 */
function normalizeBotPrefix(botPrefix) {
  const normalized = String(botPrefix ?? DEFAULT_CONFIG.botPrefix).trim();
  if (normalized.length > 32) {
    throw new WecomBotConfigServiceError('BOT_PREFIX_INVALID', 'Bot Prefix is too long');
  }

  return normalized;
}

/**
 * 规范化并校验私聊策略。
 * 输入: 请求体中的 privateChatPolicy。
 * 输出: 合法策略值；非法时抛出 INVALID_POLICY。
 */
function normalizePrivateChatPolicy(privateChatPolicy) {
  const normalized = privateChatPolicy || DEFAULT_CONFIG.privateChatPolicy;
  if (!VALID_PRIVATE_CHAT_POLICIES.includes(normalized)) {
    throw new WecomBotConfigServiceError('INVALID_POLICY', 'Invalid private chat policy');
  }

  return normalized;
}

/**
 * 规范化并校验 FastGPT API 基础地址。
 * 输入: 请求体中的 FastGPT API Base URL。
 * 输出: 去除首尾空白后的 URL；启用时缺失或超长会抛出业务错误。
 */
function normalizeFastgptApiBaseUrl(fastgptApiBaseUrl, { required = false } = {}) {
  const normalized = String(fastgptApiBaseUrl ?? '').trim() || DEFAULT_FASTGPT_API_BASE_URL;
  if (required && !normalized) {
    throw new WecomBotConfigServiceError(
      'FASTGPT_API_BASE_URL_REQUIRED',
      'FastGPT API Base URL is required'
    );
  }

  if (normalized.length > 2048) {
    throw new WecomBotConfigServiceError(
      'FASTGPT_API_BASE_URL_INVALID',
      'FastGPT API Base URL is too long'
    );
  }

  return normalized;
}

/**
 * 比较两个 Mongo ID 是否相同。
 * 输入: 任意 ObjectId、字符串或空值。
 * 输出: 布尔值，表示二者字符串形态是否一致。
 */
function isSameId(left, right) {
  return String(left || '') === String(right || '');
}

/**
 * 判断 OpenAPI Key 校验错误是否表示绑定快照已失效。
 * 输入: OpenAPI Key 服务抛出的错误。
 * 输出: 布尔值，true 表示可安全清空旧 key 快照。
 */
function isStaleOpenApiKeyError(error) {
  return STALE_OPENAPI_KEY_ERROR_CODES.has(error?.code);
}

/**
 * 构造已清空的 FastGPT OpenAPI Key 字段。
 * 输入: 无。
 * 输出: 可写入绑定或响应序列化的空 key 字段集合。
 */
function createEmptyFastgptOpenApiKeyFields() {
  return {
    fastgptOpenApiKeyId: null,
    fastgptOpenApiKeyName: '',
    fastgptOpenApiKeyMasked: '',
    fastgptApiKeyCiphertext: null,
    fastgptApiKeyVersion: ''
  };
}

/**
 * 查询仍在有效租约内的 Worker 状态。
 * 输入: Worker 状态模型、Bot ID 和当前时间函数。
 * 输出: 有效状态记录或 null。
 */
async function findActiveWorkerStatus(StatusModel, botId, now) {
  if (!botId || !StatusModel || typeof StatusModel.findOne !== 'function') {
    return null;
  }
  if (StatusModel.db && StatusModel.db.readyState !== 1) {
    return null;
  }

  const query = StatusModel.findOne({
    botId,
    leaseExpiresAt: { $gt: now() }
  });
  if (query && typeof query.lean === 'function') {
    query.lean();
  }

  return toPlainDocument(await executeQuery(query));
}

/**
 * 从绑定快照生成状态响应字段。
 * 输入: Bot 绑定普通对象。
 * 输出: 前端状态、最近连接时间和脱敏错误摘要。
 */
function createSnapshotStatusFields(plainBinding) {
  return {
    connectionStatus: plainBinding?.connectionStatusSnapshot || 'stopped',
    lastConnectedAt: plainBinding?.lastConnectedAtSnapshot || null,
    lastError: sanitizeSensitiveSummary(plainBinding?.lastErrorSnapshot || '')
  };
}

/**
 * 从有效 Worker 状态生成状态响应字段。
 * 输入: Worker 状态记录。
 * 输出: 前端状态、最近连接时间和脱敏错误摘要。
 */
function createWorkerStatusFields(workerStatus) {
  return {
    connectionStatus: workerStatus?.status || 'stopped',
    lastConnectedAt: workerStatus?.lastConnectedAt || null,
    lastError: sanitizeSensitiveSummary(workerStatus?.lastError || '')
  };
}

/**
 * 从启用但离线的绑定快照生成状态响应字段。
 * 输入: Bot 绑定普通对象。
 * 输出: disconnected 响应态和最近一次连接诊断信息。
 */
function createDisconnectedStatusFields(plainBinding) {
  const snapshot = createSnapshotStatusFields(plainBinding);
  return {
    ...snapshot,
    connectionStatus: 'disconnected'
  };
}

/**
 * 汇总配置状态响应字段。
 * 输入: Bot 绑定、状态模型和当前时间函数。
 * 输出: 有效 Worker 状态优先，否则回退绑定快照。
 */
async function resolveEffectiveStatusFields(plainBinding, StatusModel, now) {
  if (plainBinding?.enabled) {
    const workerStatus = await findActiveWorkerStatus(StatusModel, plainBinding.botId, now);
    if (workerStatus) {
      return createWorkerStatusFields(workerStatus);
    }
    return createDisconnectedStatusFields(plainBinding);
  }

  return createSnapshotStatusFields(plainBinding);
}

/**
 * 校验并刷新已有绑定中的 OpenAPI Key 快照。
 * 输入: 当前应用 ID、绑定普通对象、OpenAPI Key 服务和 Secret 服务。
 * 输出: 有效时返回最新 key 快照和加密密文；失效时返回空 key 字段。
 */
async function resolveExistingFastgptOpenApiKeyFields(appId, existingPlain, openApiKeyService, secretService) {
  if (!existingPlain?.fastgptOpenApiKeyId || !existingPlain?.fastgptApiKeyCiphertext) {
    return createEmptyFastgptOpenApiKeyFields();
  }

  try {
    const key = await openApiKeyService.resolveKeyForApp(appId, existingPlain.fastgptOpenApiKeyId);
    return {
      fastgptOpenApiKeyId: key.id,
      fastgptOpenApiKeyName: key.name || '',
      fastgptOpenApiKeyMasked: key.apiKeyMasked || '',
      fastgptApiKeyCiphertext: existingPlain.fastgptApiKeyCiphertext,
      fastgptApiKeyVersion: existingPlain.fastgptApiKeyVersion || 'v1'
    };
  } catch (error) {
    if (isStaleOpenApiKeyError(error)) {
      return createEmptyFastgptOpenApiKeyFields();
    }

    throw error;
  }
}

/**
 * 返回已校验 key 快照后的绑定对象。
 * 输入: 当前应用 ID、绑定记录、OpenAPI Key 服务和 Secret 服务。
 * 输出: 替换为有效快照或清空快照的绑定普通对象。
 */
async function withValidatedFastgptOpenApiKeySnapshot(appId, binding, openApiKeyService, secretService) {
  const plainBinding = toPlainDocument(binding);
  if (!plainBinding) {
    return null;
  }

  const fastgptApiKeyFields = await resolveExistingFastgptOpenApiKeyFields(
    appId,
    plainBinding,
    openApiKeyService,
    secretService
  );

  return {
    ...plainBinding,
    ...fastgptApiKeyFields
  };
}

/**
 * 创建前端可回显的配置 DTO。
 * 输入: Bot 绑定记录、Secret 服务和可选状态字段。
 * 输出: 不含密文/明文 Secret 的 API 配置对象。
 */
function serializeBinding(binding, secretService, statusFields = null) {
  const plainBinding = toPlainDocument(binding);
  const secretMask = secretService.maskSecretForResponse(plainBinding);
  const effectiveStatusFields = statusFields || createSnapshotStatusFields(plainBinding);

  return {
    id: plainBinding._id?.toString ? plainBinding._id.toString() : String(plainBinding._id),
    appId: plainBinding.appId?.toString ? plainBinding.appId.toString() : String(plainBinding.appId),
    appSource: plainBinding.appSource || 'fastgpt',
    enabled: Boolean(plainBinding.enabled),
    botId: plainBinding.botId,
    fastgptApiBaseUrl: plainBinding.fastgptApiBaseUrl || DEFAULT_CONFIG.fastgptApiBaseUrl,
    fastgptOpenApiKeyId: plainBinding.fastgptOpenApiKeyId
      ? (plainBinding.fastgptOpenApiKeyId.toString
        ? plainBinding.fastgptOpenApiKeyId.toString()
        : String(plainBinding.fastgptOpenApiKeyId))
      : '',
    fastgptOpenApiKeyName: plainBinding.fastgptOpenApiKeyName || '',
    fastgptOpenApiKeyMasked: plainBinding.fastgptOpenApiKeyMasked || '',
    botPrefix: plainBinding.botPrefix || DEFAULT_CONFIG.botPrefix,
    showToolMessages: Boolean(plainBinding.showToolMessages),
    showReasoning: Boolean(plainBinding.showReasoning),
    privateChatPolicy: plainBinding.privateChatPolicy || DEFAULT_CONFIG.privateChatPolicy,
    groupChatMentionEnabled: Boolean(plainBinding.groupChatMentionEnabled ?? DEFAULT_CONFIG.groupChatMentionEnabled),
    ...secretMask,
    connectionStatus: effectiveStatusFields.connectionStatus,
    lastConnectedAt: effectiveStatusFields.lastConnectedAt,
    lastError: effectiveStatusFields.lastError
  };
}

/**
 * 为保存请求解析 FastGPT OpenAPI Key 快照字段。
 * 输入: 当前应用 ID、现有绑定、请求体、OpenAPI Key 服务和 Secret 服务。
 * 输出: 应写入数据库的 key ID、脱敏展示和完整 key 加密快照字段。
 */
async function resolveFastgptOpenApiKeyFields(appId, existingPlain, payload, openApiKeyService, secretService) {
  if (payload.fastgptApiKey) {
    throw new WecomBotConfigServiceError(
      'FASTGPT_OPENAPI_KEY_REQUIRED',
      'FastGPT OpenAPI Key must be selected by id'
    );
  }

  if (payload.fastgptOpenApiKeyId) {
    const key = await openApiKeyService.resolveKeyForApp(appId, payload.fastgptOpenApiKeyId);
    return {
      fastgptOpenApiKeyId: key.id,
      fastgptOpenApiKeyName: key.name || '',
      fastgptOpenApiKeyMasked: key.apiKeyMasked || '',
      ...secretService.encryptFastgptApiKey(key.apiKey)
    };
  }

  if (existingPlain?.fastgptOpenApiKeyId && existingPlain?.fastgptApiKeyCiphertext) {
    return resolveExistingFastgptOpenApiKeyFields(appId, existingPlain, openApiKeyService, secretService);
  }

  return createEmptyFastgptOpenApiKeyFields();
}

/**
 * 从绑定记录解析启用 FastGPT 所需凭证。
 * 输入: 含 base URL 和 API Key 密文的绑定记录。
 * 输出: 可传给 FastGPT 适配器的明文凭证；缺失时抛出业务错误。
 */
function resolveFastgptCredentialsForEnable(binding, secretService) {
  const plainBinding = toPlainDocument(binding);
  const apiBaseUrl = normalizeFastgptApiBaseUrl(plainBinding?.fastgptApiBaseUrl, { required: true });
  if (!plainBinding?.fastgptOpenApiKeyId) {
    throw new WecomBotConfigServiceError(
      'FASTGPT_OPENAPI_KEY_REQUIRED',
      'FastGPT OpenAPI Key is required'
    );
  }
  const apiKey = secretService.decryptFastgptApiKey(plainBinding);

  return { apiBaseUrl, apiKey };
}

/**
 * 解析测试连接所需的 Bot 凭证。
 * 输入: 已保存绑定、请求体和 Secret 服务。
 * 输出: Bot ID 与明文 Secret；缺失时抛出业务错误。
 */
function resolveTestConnectionCredentials(existingPlain, payload, secretService) {
  if (payload.keepExistingSecret) {
    if (!existingPlain) {
      throw new WecomBotConfigServiceError('WECOM_BOT_CONFIG_NOT_FOUND', '企业微信 Bot 配置不存在', 404);
    }

    return {
      botId: normalizeBotId(existingPlain.botId),
      secret: secretService.decryptSecret(existingPlain)
    };
  }

  const botId = normalizeBotId(payload.botId);
  const secret = String(payload.secret || '').trim();
  if (!secret) {
    throw new WecomBotConfigServiceError('SECRET_REQUIRED', 'Secret is required');
  }
  if (secret === '********') {
    throw new WecomBotConfigServiceError('MASKED_SECRET_REJECTED', 'Masked Secret placeholder cannot be tested');
  }

  return { botId, secret };
}

/**
 * 判断有效 Worker 状态是否会阻塞测试连接。
 * 输入: Worker 状态记录。
 * 输出: true 表示正式连接在线或重连中，不应启动临时测试连接。
 */
function isWorkerStatusBlockingTest(workerStatus) {
  return TEST_CONNECTION_BLOCKING_STATUSES.has(workerStatus?.status);
}

/**
 * 创建企业微信 Bot 配置服务实例。
 * 输入: 可注入的 BindingModel、StatusModel、应用解析器、FastGPT 适配器、Secret 服务和 Worker 调度器。
 * 输出: 包含查询、保存、启停、重新激活、Secret 显示和测试连接能力的服务对象。
 */
function createWecomBotConfigService({
  BindingModel = WecomBotBinding,
  StatusModel = WecomBotWorkerStatus,
  appResolver = resolveBindableFastgptApp,
  fastgptAdapter = new FastgptBotAdapter(),
  openApiKeyService = createFastgptOpenApiKeyService(),
  secretService = createWecomBotSecretService(),
  scheduler = createWecomBotWorkerScheduler({ BindingModel, StatusModel, secretService }),
  clientFactory = () => new WecomAibotClient(),
  now = () => new Date()
} = {}) {
  /**
   * 序列化配置并应用真实 Worker 状态优先级。
   * 输入: Bot 绑定记录。
   * 输出: 前端配置 DTO。
   */
  async function serializeBindingForResponse(binding) {
    const plainBinding = toPlainDocument(binding);
    const statusFields = await resolveEffectiveStatusFields(plainBinding, StatusModel, now);
    return serializeBinding(plainBinding, secretService, statusFields);
  }

  /**
   * 查询当前应用的企业微信 Bot 配置。
   * 输入: FastGPT 应用 ID。
   * 输出: 已配置 config 或未配置 defaults。
   */
  async function getConfig(appId) {
    await appResolver(appId);

    const binding = await findBindingByAppId(appId);

    if (!binding) {
      return {
        exists: false,
        defaults: { ...DEFAULT_CONFIG }
      };
    }

    const validatedBinding = await withValidatedFastgptOpenApiKeySnapshot(
      appId,
      binding,
      openApiKeyService,
      secretService
    );

    return {
      exists: true,
      config: await serializeBindingForResponse(validatedBinding)
    };
  }

  /**
   * 显式解密当前应用已保存的企业微信 Bot Secret。
   * 输入: FastGPT 应用 ID。
   * 输出: Secret 明文；仅供受保护的 reveal 接口按需返回。
   */
  async function revealSecret(appId) {
    await appResolver(appId);

    const binding = await findBindingByAppId(appId);
    if (!binding) {
      throw new WecomBotConfigServiceError('WECOM_BOT_CONFIG_NOT_FOUND', '企业微信 Bot 配置不存在', 404);
    }

    return {
      secret: secretService.decryptSecret(binding)
    };
  }

  /**
   * 按应用 ID 查询包含密文字段的 Bot 绑定。
   * 输入: FastGPT 应用 ID。
   * 输出: 绑定记录或 null；用于保存后重新读取 scheduler 更新的状态快照。
   */
  async function findBindingByAppId(appId) {
    const query = BindingModel.findOne({ appId });
    if (query && typeof query.select === 'function') {
      query.select('+secretCiphertext +fastgptApiKeyCiphertext');
    }
    if (query && typeof query.lean === 'function') {
      query.lean();
    }

    return executeQuery(query);
  }

  /**
   * 创建或更新当前应用的企业微信 Bot 配置。
   * 输入: FastGPT 应用 ID、请求体和管理员上下文。
   * 输出: 保存后的 config DTO；启用时会校验 FastGPT 调用凭证。
   */
  async function saveConfig(appId, payload = {}, context = {}) {
    await appResolver(appId);

    const normalizedBotId = normalizeBotId(payload.botId);
    const normalizedBotPrefix = normalizeBotPrefix(payload.botPrefix);
    const normalizedPolicy = normalizePrivateChatPolicy(payload.privateChatPolicy);
    const enabled = Boolean(payload.enabled);
    const adminBadge = String(context.adminBadge || context.user?.Badge || 'unknown');

    const existingQuery = BindingModel.findOne({ appId });
    if (existingQuery && typeof existingQuery.select === 'function') {
      existingQuery.select('+secretCiphertext +fastgptApiKeyCiphertext');
    }
    if (existingQuery && typeof existingQuery.lean === 'function') {
      existingQuery.lean();
    }
    const existing = await executeQuery(existingQuery);
    const existingPlain = await withValidatedFastgptOpenApiKeySnapshot(
      appId,
      existing,
      openApiKeyService,
      secretService
    );
    const previousGroupChatMentionEnabled = existingPlain?.groupChatMentionEnabled ?? DEFAULT_CONFIG.groupChatMentionEnabled;
    const groupChatMentionEnabled = payload.groupChatMentionEnabled === undefined
      ? previousGroupChatMentionEnabled !== false
      : payload.groupChatMentionEnabled !== false;
    const requestedFastgptApiBaseUrl = payload.fastgptApiBaseUrl !== undefined
      ? payload.fastgptApiBaseUrl
      : existingPlain?.fastgptApiBaseUrl;
    const normalizedFastgptApiBaseUrl = normalizeFastgptApiBaseUrl(requestedFastgptApiBaseUrl, { required: enabled });

    const duplicateQuery = BindingModel.findOne({ botId: normalizedBotId });
    if (duplicateQuery && typeof duplicateQuery.lean === 'function') {
      duplicateQuery.lean();
    }
    const duplicate = await executeQuery(duplicateQuery);

    if (duplicate && !isSameId(duplicate.appId, appId)) {
      throw new WecomBotConfigServiceError('BOT_ID_ALREADY_BOUND', '该 Bot ID 已绑定到其他应用');
    }

    const secretFields = secretService.resolveSecretForSave({
      existingSecret: existingPlain,
      keepExistingSecret: Boolean(payload.keepExistingSecret),
      secret: payload.secret
    });
    const fastgptApiKeyFields = await resolveFastgptOpenApiKeyFields(
      appId,
      existingPlain,
      payload,
      openApiKeyService,
      secretService
    );
    const draftBinding = {
      ...existingPlain,
      ...fastgptApiKeyFields,
      fastgptApiBaseUrl: normalizedFastgptApiBaseUrl
    };

    if (enabled) {
      try {
        const fastgptCredentials = resolveFastgptCredentialsForEnable(draftBinding, secretService);
        await fastgptAdapter.assertCallableApp(appId, fastgptCredentials);
      } catch (error) {
        throw new WecomBotConfigServiceError(
          error.code || 'API_KEY_UNAVAILABLE',
          error.message || 'FastGPT API Key is unavailable',
          error.statusCode || 400
        );
      }
    }

    const previousEnabled = Boolean(existingPlain?.enabled);
    const previousBotId = existingPlain?.botId || '';
    const secretWillChange = !payload.keepExistingSecret && Boolean(payload.secret);
    const fastgptApiKeyWillChange = payload.fastgptOpenApiKeyId !== undefined &&
      !isSameId(existingPlain?.fastgptOpenApiKeyId, payload.fastgptOpenApiKeyId);
    const fastgptBaseUrlWillChange = (existingPlain?.fastgptApiBaseUrl || '') !== normalizedFastgptApiBaseUrl;
    const groupChatMentionWillChange = (previousGroupChatMentionEnabled !== false) !== groupChatMentionEnabled;
    const shouldRestart = enabled && previousEnabled &&
      (previousBotId !== normalizedBotId ||
        secretWillChange ||
        fastgptApiKeyWillChange ||
        fastgptBaseUrlWillChange ||
        groupChatMentionWillChange);
    const shouldStart = enabled && !previousEnabled;
    const shouldStop = !enabled && previousEnabled;
    const previousStatusFields = existingPlain
      ? await resolveEffectiveStatusFields(existingPlain, StatusModel, now)
      : createSnapshotStatusFields(existingPlain);
    const shouldMarkStarting = shouldStart || shouldRestart;
    const statusUpdateFields = !enabled
      ? {
        connectionStatusSnapshot: 'stopped',
        lastConnectedAtSnapshot: null,
        lastErrorSnapshot: ''
      }
      : shouldMarkStarting
        ? {
          connectionStatusSnapshot: 'starting',
          lastConnectedAtSnapshot: null,
          lastErrorSnapshot: ''
        }
        : {
          connectionStatusSnapshot: previousStatusFields.connectionStatus,
          lastConnectedAtSnapshot: previousStatusFields.lastConnectedAt || null,
          lastErrorSnapshot: previousStatusFields.lastError || ''
        };

    const updateFields = {
      appId,
      appSource: 'fastgpt',
      botId: normalizedBotId,
      ...secretFields,
      fastgptApiBaseUrl: normalizedFastgptApiBaseUrl,
      ...fastgptApiKeyFields,
      enabled,
      botPrefix: normalizedBotPrefix,
      showToolMessages: Boolean(payload.showToolMessages),
      showReasoning: Boolean(payload.showReasoning),
      privateChatPolicy: normalizedPolicy,
      groupChatMentionEnabled,
      ...statusUpdateFields,
      updatedBy: adminBadge
    };

    let savedBinding;
    if (existing?._id) {
      const updateQuery = BindingModel.findByIdAndUpdate(existing._id, { $set: updateFields }, { new: true });
      if (updateQuery && typeof updateQuery.select === 'function') {
        updateQuery.select('+secretCiphertext +fastgptApiKeyCiphertext');
      }
      if (updateQuery && typeof updateQuery.lean === 'function') {
        updateQuery.lean();
      }
      savedBinding = await executeQuery(updateQuery);
    } else {
      const created = new BindingModel({
        ...updateFields,
        createdBy: adminBadge
      });
      savedBinding = await created.save();
    }

    if (shouldRestart && scheduler?.restartBinding) {
      await scheduler.restartBinding(savedBinding, { previousBotId });
    } else if (shouldStart && scheduler?.startBinding) {
      await scheduler.startBinding(savedBinding);
    } else if (shouldStop && scheduler?.stopBinding) {
      await scheduler.stopBinding({ ...toPlainDocument(savedBinding), botId: previousBotId || normalizedBotId });
    }

    const responseBinding = await findBindingByAppId(appId) || savedBinding;

    return {
      config: await serializeBindingForResponse(responseBinding)
    };
  }

  /**
   * 独立启用或停用当前应用的企业微信 Bot。
   * 输入: FastGPT 应用 ID、目标启用状态和管理员上下文。
   * 输出: 启用状态和连接状态；会联动启动或停止 Worker。
   */
  async function setEnabled(appId, enabled, context = {}) {
    await appResolver(appId);

    const query = BindingModel.findOne({ appId });
    if (query && typeof query.select === 'function') {
      query.select('+secretCiphertext +fastgptApiKeyCiphertext');
    }
    if (query && typeof query.lean === 'function') {
      query.lean();
    }
    const existing = await executeQuery(query);
    const existingPlain = await withValidatedFastgptOpenApiKeySnapshot(
      appId,
      existing,
      openApiKeyService,
      secretService
    );

    if (!existingPlain) {
      throw new WecomBotConfigServiceError('WECOM_BOT_CONFIG_NOT_FOUND', '企业微信 Bot 配置不存在', 404);
    }

    if (enabled) {
      try {
        await fastgptAdapter.assertCallableApp(
          appId,
          resolveFastgptCredentialsForEnable(existingPlain, secretService)
        );
      } catch (error) {
        throw new WecomBotConfigServiceError(
          error.code || 'API_KEY_UNAVAILABLE',
          error.message || 'FastGPT API Key is unavailable',
          error.statusCode || 400
        );
      }
    }

    const adminBadge = String(context.adminBadge || context.user?.Badge || 'unknown');
    const connectionStatusSnapshot = enabled ? 'starting' : 'stopped';
    const updateQuery = BindingModel.findByIdAndUpdate(existingPlain._id, {
      $set: {
        enabled: Boolean(enabled),
        connectionStatusSnapshot,
        lastErrorSnapshot: '',
        updatedBy: adminBadge
      }
    }, { new: true });
    if (updateQuery && typeof updateQuery.select === 'function') {
      updateQuery.select('+secretCiphertext +fastgptApiKeyCiphertext');
    }
    if (updateQuery && typeof updateQuery.lean === 'function') {
      updateQuery.lean();
    }
    const savedBinding = await executeQuery(updateQuery);

    if (enabled && scheduler?.startBinding) {
      await scheduler.startBinding(savedBinding);
    } else if (!enabled && scheduler?.stopBinding) {
      await scheduler.stopBinding(savedBinding);
    }

    return {
      enabled: Boolean(enabled),
      connectionStatus: connectionStatusSnapshot
    };
  }

  /**
   * 重新激活当前应用的企业微信 Bot。
   * 输入: FastGPT 应用 ID 和管理员上下文。
   * 输出: 启用状态和 starting 连接状态；会根据原启用状态启动或重启 Worker。
   */
  async function reactivate(appId, context = {}) {
    await appResolver(appId);

    const existing = await findBindingByAppId(appId);
    const existingPlain = await withValidatedFastgptOpenApiKeySnapshot(
      appId,
      existing,
      openApiKeyService,
      secretService
    );

    if (!existingPlain) {
      throw new WecomBotConfigServiceError('WECOM_BOT_CONFIG_NOT_FOUND', '企业微信 Bot 配置不存在', 404);
    }

    try {
      await fastgptAdapter.assertCallableApp(
        appId,
        resolveFastgptCredentialsForEnable(existingPlain, secretService)
      );
    } catch (error) {
      throw new WecomBotConfigServiceError(
        error.code || 'API_KEY_UNAVAILABLE',
        error.message || 'FastGPT API Key is unavailable',
        error.statusCode || 400
      );
    }

    const wasEnabled = Boolean(existingPlain.enabled);
    const adminBadge = String(context.adminBadge || context.user?.Badge || 'unknown');
    const updateQuery = BindingModel.findByIdAndUpdate(existingPlain._id, {
      $set: {
        enabled: true,
        fastgptOpenApiKeyId: existingPlain.fastgptOpenApiKeyId || null,
        fastgptOpenApiKeyName: existingPlain.fastgptOpenApiKeyName || '',
        fastgptOpenApiKeyMasked: existingPlain.fastgptOpenApiKeyMasked || '',
        fastgptApiKeyCiphertext: existingPlain.fastgptApiKeyCiphertext || null,
        fastgptApiKeyVersion: existingPlain.fastgptApiKeyVersion || '',
        connectionStatusSnapshot: 'starting',
        lastErrorSnapshot: '',
        updatedBy: adminBadge
      }
    }, { new: true });
    if (updateQuery && typeof updateQuery.select === 'function') {
      updateQuery.select('+secretCiphertext +fastgptApiKeyCiphertext');
    }
    if (updateQuery && typeof updateQuery.lean === 'function') {
      updateQuery.lean();
    }
    const savedBinding = await executeQuery(updateQuery);

    if (wasEnabled && scheduler?.restartBinding) {
      await scheduler.restartBinding(savedBinding);
    } else if (!wasEnabled && scheduler?.startBinding) {
      await scheduler.startBinding(savedBinding);
    }

    return {
      enabled: true,
      connectionStatus: 'starting'
    };
  }

  /**
   * 测试企业微信 Bot 凭证是否可连接订阅。
   * 输入: FastGPT 应用 ID 和测试凭证请求体。
   * 输出: ok=true；正式 Worker 在线时拒绝抢占。
   */
  async function testConnection(appId, payload = {}) {
    await appResolver(appId);

    const binding = await findBindingByAppId(appId);
    const existingPlain = toPlainDocument(binding);
    const blockingStatus = existingPlain
      ? await findActiveWorkerStatus(StatusModel, existingPlain.botId, now)
      : null;
    if (isWorkerStatusBlockingTest(blockingStatus)) {
      throw new WecomBotConfigServiceError(
        'WECOM_BOT_WORKER_ACTIVE',
        '正式企业微信 Bot Worker 已在线，不能抢占测试连接',
        409
      );
    }

    const credentials = resolveTestConnectionCredentials(existingPlain, payload, secretService);
    const client = clientFactory();

    try {
      await client.connect({
        botId: credentials.botId,
        secret: credentials.secret
      });
      return { ok: true };
    } catch (error) {
      throw new WecomBotConfigServiceError(
        'WECOM_BOT_TEST_CONNECTION_FAILED',
        sanitizeSensitiveSummary(error, [credentials.secret, credentials.botId]) || '企业微信 Bot 测试连接失败',
        error.statusCode || 400
      );
    } finally {
      if (client && typeof client.close === 'function') {
        await client.close().catch(() => undefined);
      }
    }
  }

  return {
    getConfig,
    revealSecret,
    saveConfig,
    setEnabled,
    reactivate,
    testConnection
  };
}

module.exports = {
  DEFAULT_CONFIG,
  WecomBotConfigServiceError,
  createWecomBotConfigService,
  resolveEffectiveStatusFields,
  sanitizeSensitiveSummary,
  serializeBinding
};
