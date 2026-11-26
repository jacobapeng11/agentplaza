const DEFAULT_LEASE_TTL_SECONDS = 60;
const DEFAULT_LEASE_RENEW_INTERVAL_SECONDS = 5;
const DEFAULT_LEASE_RENEW_RETRY_ATTEMPTS = 3;
const DEFAULT_LEASE_RENEW_RETRY_DELAY_MS = 3000;
const DEFAULT_MESSAGE_DEDUP_TTL_SECONDS = 48 * 60 * 60;
const DEFAULT_MAX_INBOUND_TEXT_LENGTH = 4000;
const DEFAULT_FASTGPT_CHAT_TIMEOUT_MS = 600000;
const DEFAULT_AUTH_FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const DEFAULT_TRANSIENT_FAILURE_BACKOFF_MS = 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000;
const DEFAULT_RECOVERY_AUTH_TIMEOUT_MS = 15000;
const DEFAULT_MAX_REPLY_LENGTH = 3500;
const DEFAULT_MAX_INBOUND_MEDIA_COUNT = 1;
const DEFAULT_MAX_INBOUND_MIXED_IMAGE_COUNT = 10;
const DEFAULT_MAX_INBOUND_MEDIA_BYTES = 5 * 1024 * 1024;
const DEFAULT_INBOUND_AGGREGATION_WINDOW_MS = 500;
const DEFAULT_INBOUND_QUEUE_IDLE_TTL_MS = 60 * 1000;
const DEFAULT_INBOUND_MAX_QUEUE_LENGTH = 50;
const DEFAULT_INBOUND_MAX_BATCH_MESSAGES = 10;
const DEFAULT_INBOUND_MAX_BATCH_MEDIA = 10;
const DEFAULT_MEDIA_DOWNLOAD_TIMEOUT_MS = 10000;
const DEFAULT_MEDIA_UPLOAD_TIMEOUT_MS = 15000;
const DEFAULT_MEDIA_VERIFY_TIMEOUT_MS = 3000;
const DEFAULT_STREAM_UPDATE_INTERVAL_MS = 500;
const DEFAULT_STREAM_MAX_CONTENT_BYTES = 32 * 1024;
const DEFAULT_IMAGE_EXTENSIONS = 'jpg,jpeg,png,gif,webp';
const DEFAULT_FILE_EXTENSIONS = 'txt,md,html,htm,doc,docx,pdf,ppt,pptx,csv,xls,xlsx';
const DEFAULT_FASTGPT_FAILURE_TEXT = '暂时无法回复，请稍后再试。';
const DEFAULT_MESSAGE_TEXTS = {
  fastgptFailure: DEFAULT_FASTGPT_FAILURE_TEXT,
  emptyFastgptReply: 'FastGPT 暂未返回可回复内容，请稍后重试。',
  appPermissionDenied: '你暂无该应用的使用权限，请联系应用管理员开通后再使用。',
  variableInputInvalid: '输入无效，请重新选择。',
  variableMediaBlocked: '请先完成当前表单选择后再发送图片或文件。',
  variablesCollected: '变量已设置，请发送要处理的文本、图片或文件。',
  resetConversationCommand: '重置会话',
  resetConversationReply: '会话已重置，下一条消息将开启新的对话',
  defaultMediaQuestion: '请分析我发送的图片/文件',
  groupChatUnsupported: '暂不支持群聊消息',
  groupChatAuthRequired: '请先私聊机器人完成身份认证后再在群聊中使用。',
  emptyMentionText: '请输入要咨询的问题。',
  unsupportedMediaType: '暂不支持该媒体类型，请发送图片或文档文件',
  unsupportedMessageType: '暂不支持该类型消息',
  mediaCountExceeded: '单条消息附件数量超限，请减少后再发送',
  mediaTooLarge: '文件过大，请压缩或拆分后再发送',
  missingExternalUser: '无法识别发送人，请稍后再试',
  textTooLong: '消息太长，请缩短后再发送'
};
const DEFAULT_STREAM_FASTGPT_FAILURE_TEXT = DEFAULT_FASTGPT_FAILURE_TEXT;
const DEFAULT_STREAM_INTERRUPTED_TEXT = '回复中断，请稍后重试。';
const DEFAULT_RUNTIME_FORM_STREAM_TEXT = '请按下面提示完成表单。';
const { getDefaultFastgptApiBaseUrl } = require('./fastgpt');

/**
 * 将配置值解析为正整数。
 * 输入: 环境变量字符串和兜底值。
 * 输出: 大于 0 的整数；非法时返回兜底值。
 */
function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 将配置值解析为布尔值。
 * 输入: 环境变量字符串和兜底布尔值。
 * 输出: true/false；空值使用兜底值。
 */
function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * 将逗号分隔配置解析为小写字符串数组。
 * 输入: 环境变量字符串和默认逗号分隔值。
 * 输出: 去空白、去空项后的数组。
 */
function toCsvList(value, fallback) {
  return String(value || fallback || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 将配置值解析为非空字符串。
 * 输入: 环境变量字符串和兜底字符串。
 * 输出: 原始字符串非空时返回原值，否则返回兜底值。
 */
function toConfiguredText(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return String(value);
}

/**
 * 读取企业微信 Bot 运行配置。
 * 输入: 环境变量对象，默认使用 process.env。
 * 输出: Worker、SDK、租约、重试、FastGPT、消息安全和媒体配置对象。
 */
function readWecomBotConfig(env = process.env) {
  return {
    enabled: toBoolean(env.WECOM_BOT_WORKER_ENABLED),
    sdkImportPath: env.WECOM_AIBOT_SDK_IMPORT || '@wecom/aibot-node-sdk',
    instanceId: env.WECOM_BOT_INSTANCE_ID || env.HOSTNAME || `agent-plaza-${process.pid}`,
    sdk: {
      heartbeatIntervalMs: toPositiveInteger(
        env.WECOM_BOT_HEARTBEAT_INTERVAL_MS,
        DEFAULT_HEARTBEAT_INTERVAL_MS
      )
    },
    lease: {
      ttlSeconds: toPositiveInteger(env.WECOM_BOT_LEASE_TTL_SECONDS, DEFAULT_LEASE_TTL_SECONDS),
      renewIntervalSeconds: toPositiveInteger(
        env.WECOM_BOT_LEASE_RENEW_INTERVAL_SECONDS,
        DEFAULT_LEASE_RENEW_INTERVAL_SECONDS
      ),
      renewRetryAttempts: toPositiveInteger(
        env.WECOM_BOT_LEASE_RENEW_RETRY_ATTEMPTS,
        DEFAULT_LEASE_RENEW_RETRY_ATTEMPTS
      ),
      renewRetryDelayMs: toPositiveInteger(
        env.WECOM_BOT_LEASE_RENEW_RETRY_DELAY_MS,
        DEFAULT_LEASE_RENEW_RETRY_DELAY_MS
      )
    },
    retry: {
      maxAttempts: toPositiveInteger(env.WECOM_BOT_RETRY_MAX_ATTEMPTS, 3),
      baseDelayMs: toPositiveInteger(env.WECOM_BOT_RETRY_BASE_DELAY_MS, 1000),
      maxAuthFailureAttempts: toPositiveInteger(env.WECOM_BOT_AUTH_FAILURE_MAX_ATTEMPTS, 5),
      authFailureBackoffMs: toPositiveInteger(
        env.WECOM_BOT_AUTH_FAILURE_BACKOFF_MS,
        DEFAULT_AUTH_FAILURE_BACKOFF_MS
      ),
      transientFailureBackoffMs: toPositiveInteger(
        env.WECOM_BOT_TRANSIENT_FAILURE_BACKOFF_MS,
        DEFAULT_TRANSIENT_FAILURE_BACKOFF_MS
      ),
      recoveryAuthTimeoutMs: toPositiveInteger(
        env.WECOM_BOT_RECOVERY_AUTH_TIMEOUT_MS,
        DEFAULT_RECOVERY_AUTH_TIMEOUT_MS
      )
    },
    fastgpt: {
      apiBaseUrl: getDefaultFastgptApiBaseUrl(env),
      apiKey: env.FASTGPT_API_KEY || '',
      openapiPrefix: env.FASTGPT_OPENAPI_PREFIX || 'fastgpt',
      chatTimeoutMs: toPositiveInteger(env.FASTGPT_CHAT_TIMEOUT_MS, DEFAULT_FASTGPT_CHAT_TIMEOUT_MS)
    },
    message: {
      dedupTtlSeconds: toPositiveInteger(env.WECOM_BOT_MESSAGE_DEDUP_TTL_SECONDS, DEFAULT_MESSAGE_DEDUP_TTL_SECONDS),
      maxInboundTextLength: toPositiveInteger(env.WECOM_BOT_MAX_INBOUND_TEXT_LENGTH, DEFAULT_MAX_INBOUND_TEXT_LENGTH),
      maxReplyLength: toPositiveInteger(env.WECOM_BOT_MAX_REPLY_LENGTH, DEFAULT_MAX_REPLY_LENGTH),
      maxInboundMediaCount: toPositiveInteger(env.WECOM_BOT_MAX_INBOUND_MEDIA_COUNT, DEFAULT_MAX_INBOUND_MEDIA_COUNT),
      maxInboundMixedImageCount: toPositiveInteger(
        env.WECOM_BOT_MAX_INBOUND_MIXED_IMAGE_COUNT,
        DEFAULT_MAX_INBOUND_MIXED_IMAGE_COUNT
      ),
      maxInboundMediaBytes: toPositiveInteger(env.WECOM_BOT_MAX_INBOUND_MEDIA_BYTES, DEFAULT_MAX_INBOUND_MEDIA_BYTES),
      inboundAggregationWindowMs: toPositiveInteger(
        env.WECOM_BOT_INBOUND_AGGREGATION_WINDOW_MS,
        DEFAULT_INBOUND_AGGREGATION_WINDOW_MS
      ),
      inboundQueueIdleTtlMs: toPositiveInteger(
        env.WECOM_BOT_INBOUND_QUEUE_IDLE_TTL_MS,
        DEFAULT_INBOUND_QUEUE_IDLE_TTL_MS
      ),
      inboundMaxQueueLength: toPositiveInteger(
        env.WECOM_BOT_INBOUND_MAX_QUEUE_LENGTH,
        DEFAULT_INBOUND_MAX_QUEUE_LENGTH
      ),
      inboundMaxBatchMessages: toPositiveInteger(
        env.WECOM_BOT_INBOUND_MAX_BATCH_MESSAGES,
        DEFAULT_INBOUND_MAX_BATCH_MESSAGES
      ),
      inboundMaxBatchMedia: toPositiveInteger(
        env.WECOM_BOT_INBOUND_MAX_BATCH_MEDIA,
        DEFAULT_INBOUND_MAX_BATCH_MEDIA
      ),
      texts: {
        fastgptFailure: toConfiguredText(env.WECOM_BOT_FASTGPT_FAILURE_TEXT, DEFAULT_MESSAGE_TEXTS.fastgptFailure),
        emptyFastgptReply: toConfiguredText(
          env.WECOM_BOT_EMPTY_FASTGPT_REPLY_TEXT,
          DEFAULT_MESSAGE_TEXTS.emptyFastgptReply
        ),
        appPermissionDenied: toConfiguredText(
          env.WECOM_BOT_APP_PERMISSION_DENIED_TEXT,
          DEFAULT_MESSAGE_TEXTS.appPermissionDenied
        ),
        variableInputInvalid: toConfiguredText(
          env.WECOM_BOT_VARIABLE_INPUT_INVALID_TEXT,
          DEFAULT_MESSAGE_TEXTS.variableInputInvalid
        ),
        variableMediaBlocked: toConfiguredText(
          env.WECOM_BOT_VARIABLE_MEDIA_BLOCKED_TEXT,
          DEFAULT_MESSAGE_TEXTS.variableMediaBlocked
        ),
        variablesCollected: toConfiguredText(
          env.WECOM_BOT_VARIABLES_COLLECTED_TEXT,
          DEFAULT_MESSAGE_TEXTS.variablesCollected
        ),
        resetConversationCommand: toConfiguredText(
          env.WECOM_BOT_RESET_CONVERSATION_COMMAND_TEXT,
          DEFAULT_MESSAGE_TEXTS.resetConversationCommand
        ),
        resetConversationReply: toConfiguredText(
          env.WECOM_BOT_RESET_CONVERSATION_REPLY_TEXT,
          DEFAULT_MESSAGE_TEXTS.resetConversationReply
        ),
        defaultMediaQuestion: toConfiguredText(
          env.WECOM_BOT_DEFAULT_MEDIA_QUESTION,
          DEFAULT_MESSAGE_TEXTS.defaultMediaQuestion
        ),
        groupChatUnsupported: toConfiguredText(
          env.WECOM_BOT_GROUP_CHAT_UNSUPPORTED_TEXT,
          DEFAULT_MESSAGE_TEXTS.groupChatUnsupported
        ),
        groupChatAuthRequired: toConfiguredText(
          env.WECOM_BOT_GROUP_CHAT_AUTH_REQUIRED_TEXT,
          DEFAULT_MESSAGE_TEXTS.groupChatAuthRequired
        ),
        emptyMentionText: toConfiguredText(
          env.WECOM_BOT_EMPTY_MENTION_TEXT,
          DEFAULT_MESSAGE_TEXTS.emptyMentionText
        ),
        unsupportedMediaType: toConfiguredText(
          env.WECOM_BOT_UNSUPPORTED_MEDIA_TYPE_TEXT,
          DEFAULT_MESSAGE_TEXTS.unsupportedMediaType
        ),
        unsupportedMessageType: toConfiguredText(
          env.WECOM_BOT_UNSUPPORTED_MESSAGE_TYPE_TEXT,
          DEFAULT_MESSAGE_TEXTS.unsupportedMessageType
        ),
        mediaCountExceeded: toConfiguredText(
          env.WECOM_BOT_MEDIA_COUNT_EXCEEDED_TEXT,
          DEFAULT_MESSAGE_TEXTS.mediaCountExceeded
        ),
        mediaTooLarge: toConfiguredText(env.WECOM_BOT_MEDIA_TOO_LARGE_TEXT, DEFAULT_MESSAGE_TEXTS.mediaTooLarge),
        missingExternalUser: toConfiguredText(
          env.WECOM_BOT_MISSING_EXTERNAL_USER_TEXT,
          DEFAULT_MESSAGE_TEXTS.missingExternalUser
        ),
        textTooLong: toConfiguredText(env.WECOM_BOT_TEXT_TOO_LONG_TEXT, DEFAULT_MESSAGE_TEXTS.textTooLong)
      }
    },
    media: {
      uploadUrl: env.WECOM_BOT_MEDIA_UPLOAD_URL || '',
      publicBaseUrl: env.WECOM_BOT_MEDIA_PUBLIC_BASE_URL || '',
      allowedHosts: toCsvList(env.WECOM_BOT_MEDIA_ALLOWED_HOSTS, ''),
      uploadResponseHosts: toCsvList(env.WECOM_BOT_MEDIA_UPLOAD_RESPONSE_HOSTS, ''),
      bucketName: env.WECOM_BOT_MEDIA_BUCKET_NAME || 'agentplaza-media',
      allowedImageExtensions: toCsvList(env.WECOM_BOT_MEDIA_IMAGE_EXTENSIONS, DEFAULT_IMAGE_EXTENSIONS),
      allowedFileExtensions: toCsvList(env.WECOM_BOT_MEDIA_FILE_EXTENSIONS, DEFAULT_FILE_EXTENSIONS),
      maxInboundMediaCount: toPositiveInteger(env.WECOM_BOT_MAX_INBOUND_MEDIA_COUNT, DEFAULT_MAX_INBOUND_MEDIA_COUNT),
      maxInboundMediaBytes: toPositiveInteger(env.WECOM_BOT_MAX_INBOUND_MEDIA_BYTES, DEFAULT_MAX_INBOUND_MEDIA_BYTES),
      downloadTimeoutMs: toPositiveInteger(env.WECOM_BOT_MEDIA_DOWNLOAD_TIMEOUT_MS, DEFAULT_MEDIA_DOWNLOAD_TIMEOUT_MS),
      uploadTimeoutMs: toPositiveInteger(env.WECOM_BOT_MEDIA_UPLOAD_TIMEOUT_MS, DEFAULT_MEDIA_UPLOAD_TIMEOUT_MS),
      verifyTimeoutMs: toPositiveInteger(env.WECOM_BOT_MEDIA_VERIFY_TIMEOUT_MS, DEFAULT_MEDIA_VERIFY_TIMEOUT_MS),
      outboundNativeSendFallbackEnabled: toBoolean(env.WECOM_BOT_MEDIA_OUTBOUND_FALLBACK_ENABLED, true)
    },
    streaming: {
      enabled: toBoolean(env.WECOM_BOT_STREAMING_ENABLED, true),
      thinkingPlaceholder: env.WECOM_BOT_THINKING_PLACEHOLDER || '🤔 Thinking...',
      updateIntervalMs: toPositiveInteger(
        env.WECOM_BOT_STREAM_UPDATE_INTERVAL_MS,
        DEFAULT_STREAM_UPDATE_INTERVAL_MS
      ),
      maxContentBytes: toPositiveInteger(
        env.WECOM_BOT_STREAM_MAX_CONTENT_BYTES,
        DEFAULT_STREAM_MAX_CONTENT_BYTES
      ),
      fastgptFailureText: toConfiguredText(
        env.WECOM_BOT_STREAM_FASTGPT_FAILURE_TEXT || env.WECOM_BOT_FASTGPT_FAILURE_TEXT,
        DEFAULT_STREAM_FASTGPT_FAILURE_TEXT
      ),
      interruptedText: toConfiguredText(env.WECOM_BOT_STREAM_INTERRUPTED_TEXT, DEFAULT_STREAM_INTERRUPTED_TEXT),
      runtimeFormText: toConfiguredText(env.WECOM_BOT_RUNTIME_FORM_STREAM_TEXT, DEFAULT_RUNTIME_FORM_STREAM_TEXT)
    },
    testMode: env.NODE_ENV === 'test' || toBoolean(env.WECOM_BOT_DISABLE_BOOTSTRAP, false)
  };
}

module.exports = {
  readWecomBotConfig,
  wecomBotConfig: readWecomBotConfig()
};
