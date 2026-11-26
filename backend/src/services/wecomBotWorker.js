const axios = require('axios');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const { SaxesParser } = require('saxes');
const yauzl = require('yauzl');
const { WecomAibotClient } = require('./wecomAibotClient');
const { FastgptBotAdapter } = require('./fastgptBotAdapter');
const { createWecomBotDedupService } = require('./wecomBotDedupService');
const { createWecomMessagePolicyService } = require('./wecomMessagePolicyService');
const { createWecomUserBindingService } = require('./wecomUserBindingService');
const { createWecomMediaStorageService } = require('./wecomMediaStorageService');
const { createWecomInboundQueueService } = require('./wecomInboundQueueService');
const { createFastgptAppPermissionService } = require('./fastgptAppPermissionService');
const {
  buildSafeStreamPreview,
  createReplyRenderPlan,
  renderReplyPlan,
  splitMarkdownReply
} = require('./fastgptReplyMediaRenderer');
const { wecomBotConfig } = require('../config/wecomBot');
const appLogger = require('../utils/logger');
const { redactCredentialText } = require('../utils/credentialText');

const VALID_STATES = ['stopped', 'starting', 'connected', 'reconnecting', 'failed'];
const AUTH_FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const TRANSIENT_FAILURE_BACKOFF_MS = 1000;
const MAX_SERVER_DISCONNECT_RECOVERY_DELAY_MS = 30000;
const DEFAULT_RECOVERY_AUTH_TIMEOUT_MS = 15000;
const SERVER_REPLACEMENT_DISCONNECT_PATTERN = /new connection established|server disconnected this connection/i;
const MAX_WECOM_REPLY_LENGTH = 3500;
const DEFAULT_OUTBOUND_MEDIA_CONCURRENCY = 4;
const MAX_OUTBOUND_MEDIA_NAME_LENGTH = 120;
const MAX_OUTBOUND_MEDIA_INSPECTION_BYTES = 64 * 1024;
const MAX_OUTBOUND_MEDIA_REDIRECTS = 5;
const MAX_OUTBOUND_OFFICE_ENTRIES = 2048;
const MAX_OUTBOUND_OFFICE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_OUTBOUND_OFFICE_CONTENT_TYPES_BYTES = 1024 * 1024;
const MAX_OUTBOUND_OFFICE_ROOT_INSPECTION_BYTES = 64 * 1024;
const EMPTY_FASTGPT_REPLY_TEXT = 'FastGPT 暂未返回可回复内容，请稍后重试。';
const DEFAULT_STREAM_UPDATE_INTERVAL_MS = 250;
const DEFAULT_STREAM_MAX_CONTENT_BYTES = 64 * 1024;
const DEFAULT_STREAM_THINKING_PLACEHOLDER = '🤔 Thinking...';
const STREAM_FASTGPT_FAILURE_TEXT = '暂时无法回复，请稍后再试。';
const STREAM_INTERRUPTED_TEXT = '回复中断，请稍后重试。';
const APP_USE_PERMISSION_DENIED_TEXT = '你暂无该应用的使用权限，请联系应用管理员开通后再使用。';
const VARIABLE_INPUT_INVALID_TEXT = '输入无效，请重新选择。';
const VARIABLE_MEDIA_BLOCKED_TEXT = '请先完成当前表单选择后再发送图片或文件。';
const VARIABLES_COLLECTED_TEXT = '变量已设置，请发送要处理的文本、图片或文件。';
const RUNTIME_FORM_STREAM_TEXT = '请按下面提示完成表单。';
const FASTGPT_FAILURE_TEXT = STREAM_FASTGPT_FAILURE_TEXT;
const GROUP_REPLY_TOO_LARGE_TEXT = '回复内容过长，无法在群聊中完整展示，请缩小请求范围后重试。';
const GROUP_FORM_TOO_LARGE_TEXT = '表单选项过多，无法在企微单条消息中完整展示，请联系应用管理员精简选项。';
const GROUP_REPLY_SECTION_SEPARATOR = '\n\n\u200B\n\n';
const QUOTE_CONTEXT_HEADING_TEXT = '引用消息上下文：';
const DEFAULT_WORKER_MESSAGE_TEXTS = {
  fastgptFailure: FASTGPT_FAILURE_TEXT,
  emptyFastgptReply: EMPTY_FASTGPT_REPLY_TEXT,
  appPermissionDenied: APP_USE_PERMISSION_DENIED_TEXT,
  variableInputInvalid: VARIABLE_INPUT_INVALID_TEXT,
  variableMediaBlocked: VARIABLE_MEDIA_BLOCKED_TEXT,
  variablesCollected: VARIABLES_COLLECTED_TEXT,
  groupChatAuthRequired: '请先私聊机器人完成身份认证后再在群聊中使用。'
};
const OUTBOUND_REPLY_STAGES = {
  parse: 'parse',
  download: 'download',
  ossUpload: 'oss_upload',
  markdownSend: 'markdown_send',
  nativeSend: 'native_send',
  linkFallback: 'link_fallback'
};
const MEDIA_METADATA_BY_EXTENSION = {
  jpg: { type: 'image', extension: 'jpg', mimeType: 'image/jpeg' },
  jpeg: { type: 'image', extension: 'jpg', mimeType: 'image/jpeg' },
  png: { type: 'image', extension: 'png', mimeType: 'image/png' },
  gif: { type: 'image', extension: 'gif', mimeType: 'image/gif' },
  webp: { type: 'image', extension: 'webp', mimeType: 'image/webp' },
  pdf: { type: 'file', extension: 'pdf', mimeType: 'application/pdf' },
  txt: { type: 'file', extension: 'txt', mimeType: 'text/plain' },
  md: { type: 'file', extension: 'md', mimeType: 'text/markdown' },
  html: { type: 'file', extension: 'html', mimeType: 'text/html' },
  htm: { type: 'file', extension: 'htm', mimeType: 'text/html' },
  csv: { type: 'file', extension: 'csv', mimeType: 'text/csv' },
  doc: { type: 'file', extension: 'doc', mimeType: 'application/msword' },
  docx: {
    type: 'file',
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  },
  xls: { type: 'file', extension: 'xls', mimeType: 'application/vnd.ms-excel' },
  xlsx: {
    type: 'file',
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  },
  ppt: { type: 'file', extension: 'ppt', mimeType: 'application/vnd.ms-powerpoint' },
  pptx: {
    type: 'file',
    extension: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  }
};
const MEDIA_METADATA_BY_MIME = {
  'image/jpeg': MEDIA_METADATA_BY_EXTENSION.jpg,
  'image/jpg': MEDIA_METADATA_BY_EXTENSION.jpg,
  'image/png': MEDIA_METADATA_BY_EXTENSION.png,
  'image/gif': MEDIA_METADATA_BY_EXTENSION.gif,
  'image/webp': MEDIA_METADATA_BY_EXTENSION.webp,
  'application/pdf': MEDIA_METADATA_BY_EXTENSION.pdf,
  'text/plain': MEDIA_METADATA_BY_EXTENSION.txt,
  'text/markdown': MEDIA_METADATA_BY_EXTENSION.md,
  'text/html': MEDIA_METADATA_BY_EXTENSION.html,
  'text/csv': MEDIA_METADATA_BY_EXTENSION.csv,
  'application/msword': MEDIA_METADATA_BY_EXTENSION.doc,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': MEDIA_METADATA_BY_EXTENSION.docx,
  'application/vnd.ms-excel': MEDIA_METADATA_BY_EXTENSION.xls,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': MEDIA_METADATA_BY_EXTENSION.xlsx,
  'application/vnd.ms-powerpoint': MEDIA_METADATA_BY_EXTENSION.ppt,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': MEDIA_METADATA_BY_EXTENSION.pptx
};
const OOXML_MEDIA_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx']);
const OLE_MEDIA_EXTENSIONS = new Set(['doc', 'xls', 'ppt']);
const OOXML_PACKAGE_REQUIREMENTS = {
  docx: {
    mainPart: 'word/document.xml',
    mainContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    rootElement: 'document',
    rootNamespace: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  },
  xlsx: {
    mainPart: 'xl/workbook.xml',
    mainContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    rootElement: 'workbook',
    rootNamespace: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  },
  pptx: {
    mainPart: 'ppt/presentation.xml',
    mainContentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    rootElement: 'presentation',
    rootNamespace: 'http://schemas.openxmlformats.org/presentationml/2006/main'
  }
};
const ALLOWED_TRANSITIONS = {
  stopped: ['starting'],
  starting: ['connected', 'reconnecting', 'failed', 'stopped'],
  connected: ['reconnecting', 'stopped', 'failed'],
  reconnecting: ['connected', 'failed', 'stopped'],
  failed: ['stopped']
};

/**
 * 读取当前毫秒时间。
 * 输入: 无。
 * 输出: 当前 Unix 毫秒时间戳。
 */
function defaultNow() {
  return Date.now();
}

/**
 * 解析默认日志器。
 * 输入: 当前运行环境。
 * 输出: 测试环境返回 null，其他环境返回项目统一日志器。
 */
function defaultLogger(env = process.env) {
  return env.NODE_ENV === 'test' ? null : appLogger;
}

/**
 * 记录结构化诊断日志。
 * 输入: logger 对象、日志级别、消息和安全元数据。
 * 输出: 无；logger 不可用时静默跳过。
 */
function writeStructuredLog(logger, level, message, meta = {}) {
  const log = logger?.[level] || logger?.info || logger?.log;
  if (typeof log === 'function') {
    log.call(logger, message, meta);
  }
}

/**
 * 读取正整数运行配置。
 * 输入: 候选值和兜底值。
 * 输出: 大于 0 的整数；非法时返回兜底值。
 */
function resolvePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 解析 Worker 重试退避配置。
 * 输入: 企业微信 Bot 配置对象。
 * 输出: 鉴权失败和瞬时失败的退避毫秒数。
 */
function resolveRetryBackoffConfig(config = {}) {
  return {
    authFailureBackoffMs: resolvePositiveInteger(config?.retry?.authFailureBackoffMs, AUTH_FAILURE_BACKOFF_MS),
    transientFailureBackoffMs: resolvePositiveInteger(
      config?.retry?.transientFailureBackoffMs,
      TRANSIENT_FAILURE_BACKOFF_MS
    )
  };
}

/**
 * 判断断开原因是否来自企业微信服务端的连接替换事件。
 * 输入: SDK disconnected 事件携带的原因。
 * 输出: true 表示 SDK 不会自行重连，需要 Worker 主动恢复。
 */
function isServerReplacementDisconnect(reason) {
  return SERVER_REPLACEMENT_DISCONNECT_PATTERN.test(String(reason || ''));
}

/**
 * 计算服务端主动断开后的指数退避时间。
 * 输入: 从 1 开始的恢复次数、基础延迟和最大延迟。
 * 输出: 本次恢复应等待的毫秒数。
 */
function calculateServerDisconnectRecoveryDelay(
  attempt,
  baseDelayMs,
  maxDelayMs = MAX_SERVER_DISCONNECT_RECOVERY_DELAY_MS
) {
  const safeAttempt = Math.max(1, resolvePositiveInteger(attempt, 1));
  const safeBaseDelayMs = resolvePositiveInteger(baseDelayMs, TRANSIENT_FAILURE_BACKOFF_MS);
  return Math.min(safeBaseDelayMs * (2 ** (safeAttempt - 1)), maxDelayMs);
}

/**
 * 解析 Worker 用户可见文案配置。
 * 输入: 企业微信 Bot 配置对象。
 * 输出: 合并默认值后的 Worker 文案对象。
 */
function resolveWorkerMessageTexts(config = {}) {
  const configuredTexts = config?.message?.texts || {};
  return Object.fromEntries(Object.entries(DEFAULT_WORKER_MESSAGE_TEXTS).map(([key, fallback]) => [
    key,
    configuredTexts[key] === undefined || configuredTexts[key] === null || configuredTexts[key] === ''
      ? fallback
      : String(configuredTexts[key])
  ]));
}

/**
 * 根据聊天类型选择认证提示。
 * 输入: 队列项、绑定查询结果和 Worker 文案配置。
 * 输出: 可发送给企业微信的认证提示文本。
 */
function getAuthRequiredReplyText(item, boundUser, config = {}) {
  if (item?.message?.chatType === 'group' || item?.decision?.chatType === 'group') {
    return config?.message?.texts?.groupChatAuthRequired || DEFAULT_WORKER_MESSAGE_TEXTS.groupChatAuthRequired;
  }

  return boundUser?.replyText;
}

/**
 * 创建企业微信 Worker 状态机。
 * 输入: 可选初始状态，默认 stopped。
 * 输出: 可查询和转换状态的轻量状态机对象。
 */
function createWecomBotWorkerStateMachine(initialState = 'stopped') {
  let currentState = initialState;

  if (!VALID_STATES.includes(currentState)) {
    throw new Error(`Invalid worker state: ${currentState}`);
  }

  return {
    /**
     * 读取当前 Worker 状态。
     * 输入: 无。
     * 输出: 当前状态字符串。
     */
    current() {
      return currentState;
    },

    /**
     * 转换 Worker 状态。
     * 输入: 目标状态。
     * 输出: 转换后的当前状态；非法转换会抛出错误。
     */
    transition(nextState) {
      if (!VALID_STATES.includes(nextState)) {
        throw new Error(`Invalid worker state: ${nextState}`);
      }

      if (!ALLOWED_TRANSITIONS[currentState]?.includes(nextState)) {
        throw new Error(`Invalid worker state transition: ${currentState} -> ${nextState}`);
      }

      currentState = nextState;
      return currentState;
    }
  };
}

/**
 * 分类 SDK 或连接错误。
 * 输入: SDK 抛出的错误对象和可选 Worker 配置。
 * 输出: category、retryable 和 retryAfterMs，用于状态摘要和退避策略。
 */
function classifyWorkerError(error, config = wecomBotConfig) {
  const retryBackoff = resolveRetryBackoffConfig(config);
  const code = String(error?.code || error?.statusCode || error?.response?.status || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  const isAuthFailure = ['401', '403', 'AUTH_FAILED', 'INVALID_SECRET', 'UNAUTHORIZED', 'WECOM_AUTH_FAILED']
    .includes(code) ||
    error?.name === 'WSAuthFailureError' ||
    /auth|secret|unauthorized|forbidden|鉴权|凭证/.test(message);

  const isReconnectExhausted = code === 'WS_RECONNECT_EXHAUSTED' ||
    error?.name === 'WSReconnectExhaustedError';

  if (isAuthFailure) {
    return {
      category: 'auth_failed',
      retryable: false,
      retryAfterMs: retryBackoff.authFailureBackoffMs
    };
  }

  if (isReconnectExhausted) {
    return {
      category: 'reconnect_exhausted',
      retryable: false,
      retryAfterMs: retryBackoff.transientFailureBackoffMs
    };
  }

  const isTransient = /ECONN|ETIMEDOUT|TIMEOUT|ENOTFOUND|NETWORK/.test(code) ||
    /timeout|network|socket|connection/.test(message);

  return {
    category: isTransient ? 'transient' : 'unknown',
    retryable: true,
    retryAfterMs: retryBackoff.transientFailureBackoffMs
  };
}

/**
 * 生成可写入状态表的错误摘要。
 * 输入: 任意错误对象。
 * 输出: 不含敏感原始 payload 的简短错误消息。
 */
function summarizeWorkerError(error) {
  const classification = classifyWorkerError(error);
  return `[${classification.category}] ${sanitizeWorkerErrorSummary(error)}`.slice(0, 500);
}

/**
 * 净化 Worker 错误摘要。
 * 输入: 任意错误对象。
 * 输出: 不含 Secret、API Key、Token 和 raw payload 明显片段的摘要。
 */
function sanitizeWorkerErrorSummary(error) {
  const withoutUrls = String(error?.message || error || 'Worker error')
    .replace(/https?:\/\/[^\s"'<>)]*/gi, '[REDACTED_URL]');
  return redactCredentialText(withoutUrls, {
    preserveKey: false,
    credentialReplacement: '[REDACTED_CREDENTIAL]',
    bearerReplacement: '[REDACTED_AUTH]'
  })
    .replace(/raw payload/gi, 'payload')
    .slice(0, 500);
}

/**
 * 以有界工作池并发映射数组。
 * 输入: 待处理项、最大并发数和异步 mapper。
 * 输出: 按输入下标排列的结果数组；mapper 异常由调用方决定是否隔离。
 */
async function mapWithConcurrency(items = [], concurrency = DEFAULT_OUTBOUND_MEDIA_CONCURRENCY, mapper) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return [];
  const results = new Array(source.length);
  const workerCount = Math.min(
    resolvePositiveInteger(concurrency, DEFAULT_OUTBOUND_MEDIA_CONCURRENCY),
    source.length
  );
  let nextIndex = 0;
  // 作用: 持续领取下一个未处理下标；输入为闭包中的共享游标；输出为当前 worker 完成时的 Promise。
  const runWorker = async () => {
    while (nextIndex < source.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(source[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

/**
 * 规范化媒体流程错误码，防止第三方 code 写入日志或降级结果。
 * 输入: 不可信错误 code 与当前阶段的稳定兜底 code。
 * 输出: 最多 80 个字符的全大写业务标识符；无效值返回阶段兜底 code。
 */
function normalizeWorkerMediaErrorCode(code, fallbackCode = 'WECOM_NATIVE_MEDIA_SEND_FAILED') {
  const isValidCode = typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code);
  if (isValidCode) {
    return code;
  }
  const isValidFallbackCode = typeof fallbackCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(fallbackCode);
  return isValidFallbackCode ? fallbackCode : 'WECOM_NATIVE_MEDIA_SEND_FAILED';
}

/**
 * 构造可安全持久化的 Worker 错误。
 * 输入: 原始错误和稳定兜底错误码。
 * 输出: 仅保留净化消息与规范业务错误码的新 Error。
 */
function createSanitizedWorkerError(error, fallbackCode = 'WECOM_REPLY_FAILED') {
  const sanitizedError = new Error(sanitizeWorkerErrorSummary(error));
  sanitizedError.code = normalizeWorkerMediaErrorCode(error?.code, fallbackCode);
  return sanitizedError;
}

/**
 * 将入站处理异常映射为业务失败原因。
 * 输入: 下载、上传或 FastGPT 调用阶段抛出的错误。
 * 输出: 前端和状态排查可区分的失败 reason。
 */
function classifyInboundFailureReason(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();

  if (/WECOM.*MEDIA.*DOWNLOAD|MEDIA_DOWNLOAD|DOWNLOAD_MEDIA/.test(code) ||
    /media download|download media|下载媒体/.test(message)) {
    return 'MEDIA_DOWNLOAD_FAILED';
  }

  if (code.startsWith('MEDIA_STORAGE') || /oss upload|upload media|上传.*oss/.test(message)) {
    return 'OSS_UPLOAD_FAILED';
  }

  if (/FASTGPT.*URL|URL_UNREADABLE|MEDIA_URL_UNREADABLE/.test(code) ||
    /url.*unreadable|无法读取.*url|fastgpt.*url/.test(message)) {
    return 'FASTGPT_MEDIA_URL_UNREADABLE';
  }

  return 'FASTGPT_CALL_FAILED';
}

/**
 * 将任意 ID 转为字符串。
 * 输入: ObjectId、字符串或空值。
 * 输出: 可用于日志、幂等和策略的字符串。
 */
function toIdString(value) {
  if (value && typeof value.toString === 'function') {
    return value.toString();
  }

  return String(value || '');
}

/**
 * 生成日志用脱敏短值。
 * 输入: 任意诊断值。
 * 输出: 不暴露完整长 ID 的短字符串。
 */
function maskDiagnosticValue(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= 6) {
    return `${normalized.slice(0, 2)}...${normalized.slice(-1)}`;
  }

  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

/**
 * 脱敏企业微信 conversationKey 中的用户段。
 * 输入: conversationKey 字符串。
 * 输出: 保留结构但隐藏最后一段长 ID 的 conversationKey。
 */
function maskConversationKey(conversationKey = '') {
  const parts = String(conversationKey || '').split(':');
  if (parts.length < 2) {
    return maskDiagnosticValue(conversationKey);
  }

  parts[parts.length - 1] = maskDiagnosticValue(parts[parts.length - 1]);
  return parts.join(':');
}

/**
 * 构建 FastGPT 应用使用权校验用户信息。
 * 输入: 企业微信绑定服务返回的用户对象。
 * 输出: 可通过稳定成员 helper 映射 FastGPT 团队成员的用户信息。
 */
function buildAppUsePermissionUserInfo(boundUser = {}) {
  const username = String(boundUser.username || boundUser.employeeNumber || boundUser.Badge || '').trim();
  return {
    ...boundUser,
    username,
    employeeNumber: boundUser.employeeNumber || username,
    Badge: boundUser.Badge || username,
    badge: boundUser.badge || username,
    name: boundUser.name || username
  };
}

/**
 * 拆分企业微信长文本回复。
 * 输入: 回复文本和最大片段长度。
 * 输出: 至少包含一个片段的字符串数组。
 */
function splitReplyText(text, maxLength = MAX_WECOM_REPLY_LENGTH) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return [];
  }

  const chunks = [];
  for (let index = 0; index < normalized.length; index += maxLength) {
    chunks.push(normalized.slice(index, index + maxLength));
  }

  return chunks;
}

/**
 * 解析 Worker 流式回复配置。
 * 输入: 全局或测试注入的配置对象。
 * 输出: 统一的流式开关、占位文案、节流间隔和内容上限。
 */
function resolveStreamingConfig(config = {}) {
  const streaming = config.streaming || {};
  const enabled = streaming.enabled !== undefined
    ? Boolean(streaming.enabled)
    : config.message?.streamingEnabled !== false;

  return {
    enabled,
    thinkingPlaceholder: String(
      streaming.thinkingPlaceholder ||
      streaming.placeholderText ||
      config.message?.streamingPlaceholder ||
      DEFAULT_STREAM_THINKING_PLACEHOLDER
    ),
    updateIntervalMs: Math.max(0, Number.parseInt(
      streaming.updateIntervalMs ?? config.message?.streamUpdateIntervalMs ?? DEFAULT_STREAM_UPDATE_INTERVAL_MS,
      10
    ) || 0),
    maxContentBytes: Math.max(1, Number.parseInt(
      streaming.maxContentBytes ?? config.message?.streamMaxContentBytes ?? DEFAULT_STREAM_MAX_CONTENT_BYTES,
      10
    ) || DEFAULT_STREAM_MAX_CONTENT_BYTES),
    fastgptFailureText: String(streaming.fastgptFailureText || FASTGPT_FAILURE_TEXT),
    interruptedText: String(streaming.interruptedText || STREAM_INTERRUPTED_TEXT),
    runtimeFormText: String(streaming.runtimeFormText || RUNTIME_FORM_STREAM_TEXT)
  };
}

/**
 * 按 UTF-8 字节长度截断字符串。
 * 输入: 原始文本和最大字节数。
 * 输出: 不超过限制且不拆分 Unicode 字符的文本。
 */
function truncateUtf8Bytes(text, maxBytes) {
  const normalized = String(text || '');
  if (Buffer.byteLength(normalized, 'utf8') <= maxBytes) {
    return normalized;
  }

  let output = '';
  for (const char of normalized) {
    if (Buffer.byteLength(`${output}${char}`, 'utf8') > maxBytes) {
      break;
    }
    output += char;
  }

  return output;
}

/**
 * 选择符合企微流式字节上限的群聊最终内容。
 * 输入: 原始 Markdown、最大 UTF-8 字节数和是否为表单。
 * 输出: 最终内容、是否超限及稳定原因码。
 */
function fitGroupReplyContent(
  content = '',
  maxBytes,
  { form = false, forceOverflow = false } = {}
) {
  const normalized = String(content || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const limit = Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.floor(maxBytes)
    : 4000;
  if (!forceOverflow && Buffer.byteLength(normalized, 'utf8') <= limit) {
    return { content: normalized, overflowed: false, reason: '' };
  }
  const formOverflow = form && !forceOverflow;
  const fallback = formOverflow ? GROUP_FORM_TOO_LARGE_TEXT : GROUP_REPLY_TOO_LARGE_TEXT;
  return {
    content: truncateUtf8Bytes(fallback, limit),
    overflowed: true,
    reason: formOverflow
      ? 'WECOM_GROUP_FORM_TOO_LARGE'
      : 'WECOM_GROUP_REPLY_CONTENT_TOO_LARGE'
  };
}

/**
 * 累积可见流式文本并应用最大字节上限。
 * 输入: 当前文本、增量文本和最大字节数。
 * 输出: 截断后的累积文本。
 */
function appendStreamDelta(accumulated, delta, maxBytes) {
  return truncateUtf8Bytes(`${String(accumulated || '')}${String(delta || '')}`, maxBytes);
}

/**
 * 构建带中断提示的流式失败内容。
 * 输入: 已累积文本、最大字节数和可配置的中断提示文案。
 * 输出: 保留中断提示且不超过最大字节数的文本。
 */
function buildInterruptedStreamContent(accumulatedText, maxBytes, interruptedText = STREAM_INTERRUPTED_TEXT) {
  const suffix = `\n\n${interruptedText}`;
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const prefixBudget = Math.max(0, maxBytes - suffixBytes);
  const prefix = truncateUtf8Bytes(accumulatedText, prefixBudget);

  return truncateUtf8Bytes(`${prefix}${suffix}`, maxBytes);
}

/**
 * 从文本回复块中提取媒体 URL。
 * 输入: 纯 URL 或 Markdown 图片格式文本。
 * 输出: 可作为媒体后置链接发送的 URL；不匹配时返回空字符串。
 */
function extractMediaUrlFromText(text = '') {
  const trimmed = String(text || '').trim();
  const markdownImage = trimmed.match(/^!\[[^\]]*]\((https?:\/\/[^)]+)\)$/i);
  if (markdownImage) {
    return markdownImage[1];
  }

  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : '';
}

/**
 * 判断文本回复块是否是媒体链接。
 * 输入: 标准 replyBlock。
 * 输出: 图片或文件 URL 文本返回 true。
 */
function isMediaLinkTextBlock(block = {}) {
  if (block.type !== 'text') {
    return false;
  }

  const url = extractMediaUrlFromText(block.text);
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return Boolean(MEDIA_METADATA_BY_EXTENSION[getMediaExtension(parsed.pathname)]);
  } catch (error) {
    return Boolean(MEDIA_METADATA_BY_EXTENSION[getMediaExtension(url)]);
  }
}

/**
 * 将非文本回复块筛出供流式文本结束后发送。
 * 输入: FastGPT 适配器返回的 replyBlocks。
 * 输出: image/file 等非文本回复块数组。
 */
function getPostStreamReplyBlocks(replyBlocks = []) {
  return (Array.isArray(replyBlocks) ? replyBlocks : [])
    .filter((block) => block.type !== 'form')
    .filter((block) => block.type !== 'text' || isMediaLinkTextBlock(block));
}

/**
 * 提取回复块中的原始媒体 URL。
 * 输入: text/image/file replyBlock。
 * 输出: 可用于同轮去重的 URL；普通文本返回空字符串。
 */
function getReplyBlockMediaUrl(block = {}) {
  if (block.type === 'text') {
    return extractMediaUrlFromText(block.text);
  }

  if (block.type === 'image' || block.type === 'file') {
    return String(block.url || block.ossUrl || '').trim();
  }

  return '';
}

/**
 * 对同一轮 FastGPT 回复块做媒体 URL 去重。
 * 输入: 原始 replyBlocks。
 * 输出: 保留普通文本和首个媒体 URL 的 replyBlocks。
 */
function deduplicateReplyBlocksByMediaUrl(replyBlocks = []) {
  const seenMediaUrls = new Set();
  return (Array.isArray(replyBlocks) ? replyBlocks : []).filter((block) => {
    const mediaUrl = getReplyBlockMediaUrl(block);
    if (!mediaUrl) {
      return true;
    }

    const dedupKey = `${block.type}:${mediaUrl}`;
    if (seenMediaUrls.has(dedupKey)) {
      return false;
    }
    seenMediaUrls.add(dedupKey);
    return true;
  });
}

/**
 * 构建转存后媒体的二次去重指纹。
 * 输入: 已 materialize 的 image/file 回复块。
 * 输出: sha256、OSS hash 或文件元数据指纹；缺失时返回空字符串。
 */
function getMaterializedMediaDedupKey(block = {}) {
  const stableHash = block.sha256 || block.contentSha256 || block.ossUrlHash || block.urlHash;
  if (stableHash) {
    return `hash:${stableHash}`;
  }

  const name = String(block.name || block.filename || '').trim().toLowerCase();
  const size = Number(block.size || 0);
  const mimeType = String(block.mimeType || '').trim().toLowerCase();
  return name && size
    ? `meta:${name}:${size}:${mimeType}`
    : '';
}

/**
 * 从回复块提取可作为最终流式文本的内容。
 * 输入: FastGPT 适配器返回的 replyBlocks。
 * 输出: 合并后的文本块内容。
 */
function getTextFromReplyBlocks(replyBlocks = []) {
  return (Array.isArray(replyBlocks) ? replyBlocks : [])
    .filter((block) => block.type === 'text' && !isMediaLinkTextBlock(block))
    .map((block) => String(block.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * 提取回复块中的第一个表单块。
 * 输入: FastGPT 适配器返回的 replyBlocks。
 * 输出: form 回复块；不存在时返回 null。
 */
function getFormReplyBlock(replyBlocks = []) {
  return (Array.isArray(replyBlocks) ? replyBlocks : [])
    .find((block) => block?.type === 'form' && Array.isArray(block.fields) && block.fields.length) || null;
}

/**
 * 为真实欢迎语添加一次固定前缀。
 * 输入: 可能包含多行的欢迎语文本。
 * 输出: “欢迎语：”独占一行、原始 Markdown 从下一行开始；空输入返回空字符串。
 */
function formatWelcomeSection(text = '') {
  const normalized = String(text || '').trim();
  return normalized ? `欢迎语：\n${normalized}` : '';
}

/**
 * 使用不可见占位行拼接回复区块，避免企微 Markdown 折叠纯空白段落。
 * 输入: 欢迎语、正文、表单或媒体链接区块数组。
 * 输出: 去空并带可渲染视觉间距的单气泡 Markdown。
 */
function joinReplySections(sections = []) {
  return sections
    .map((section) => String(section || '').trim())
    .filter(Boolean)
    .join(GROUP_REPLY_SECTION_SEPARATOR);
}

/**
 * 转义 Markdown 链接显示文本。
 * 输入: 文件名或兜底标签。
 * 输出: 不会破坏方括号结构的安全显示文本。
 */
function escapeMarkdownLinkLabel(value = '') {
  return String(value || '文件').replace(/([\[\]])/g, '\\$1');
}

/**
 * 将群聊 prepared reply 合并为单气泡 Markdown。
 * 输入: 已物化的回复和可选欢迎语。
 * 输出: 正文、内联图片和命名文件链接组成的 Markdown。
 */
function buildGroupPreparedMarkdown(prepared = {}, welcomeText = '') {
  const fileLinks = (prepared.files || []).map((file) => {
    const url = String(file.url || file.ossUrl || file.originalUrl || '').trim();
    if (!url) return '';
    const label = escapeMarkdownLinkLabel(file.name || file.filename || '文件');
    return `[${label}](${url})`;
  });
  return joinReplySections([
    formatWelcomeSection(welcomeText),
    prepared.markdown,
    ...fileLinks
  ]);
}

/**
 * 判断变量值是否已填写。
 * 输入: 任意变量值。
 * 输出: 非空时返回 true。
 */
function hasVariableValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * 应用变量字段默认值。
 * 输入: 字段数组和当前变量值。
 * 输出: 合并默认值后的新对象。
 */
function applyVariableDefaults(fields = [], values = {}) {
  const nextValues = { ...(values || {}) };
  fields.forEach((field) => {
    if (!hasVariableValue(nextValues[field.key]) && hasVariableValue(field.defaultValue)) {
      nextValues[field.key] = field.defaultValue;
    }
  });
  return nextValues;
}

/**
 * 只保留开场变量字段对应的值。
 * 输入: 当前变量值和应用开场字段数组。
 * 输出: 可继续持久化复用的开场变量值。
 */
function pickAppConfigVariableValues(values = {}, fields = []) {
  const appFieldKeys = new Set(fields.map((field) => field?.key).filter(Boolean));
  if (!appFieldKeys.size) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(values || {}).filter(([key]) => appFieldKeys.has(key))
  );
}

/**
 * 判断 pending 表单是否来自 FastGPT 运行时互动。
 * 输入: pendingVariableForm。
 * 输出: 非 appConfig 来源时返回 true。
 */
function isRuntimeVariableForm(pendingForm = {}) {
  return Boolean(pendingForm?.source && pendingForm.source !== 'appConfig');
}

/**
 * 查找下一个未填写的变量字段下标。
 * 输入: 字段数组、变量值和起始下标。
 * 输出: 未填写字段下标；不存在时返回 -1。
 */
function findNextMissingVariableFieldIndex(fields = [], values = {}, startIndex = 0) {
  for (let index = Math.max(0, startIndex); index < fields.length; index += 1) {
    const field = fields[index];
    if (field?.key && !hasVariableValue(values[field.key])) {
      return index;
    }
  }
  return -1;
}

/**
 * 构建待填写表单状态。
 * 输入: 字段数组、当前字段下标、来源和 schema hash。
 * 输出: 可持久化的 pendingVariableForm。
 */
function buildPendingVariableForm({ fields = [], currentIndex = 0, source = 'appConfig', schemaHash = '' } = {}) {
  return {
    fields,
    currentIndex,
    currentKey: fields[currentIndex]?.key || '',
    source,
    schemaHash,
    taskId: `${source}:${schemaHash || 'runtime'}:${fields[currentIndex]?.key || currentIndex}`,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 读取 pending 表单的当前字段。
 * 输入: pendingVariableForm。
 * 输出: 当前字段；缺失时返回 null。
 */
function getPendingCurrentField(pendingForm = {}) {
  const fields = Array.isArray(pendingForm.fields) ? pendingForm.fields : [];
  const index = Number.isInteger(pendingForm.currentIndex) ? pendingForm.currentIndex : 0;
  return fields[index] || null;
}

/**
 * 解析选择字段的单个选项值。
 * 输入: 字段选项数组和用户输入片段。
 * 输出: 匹配成功时返回 { matched: true, value }，否则返回 { matched: false }。
 */
function resolveVariableOptionValue(options = [], rawText = '') {
  const normalizedText = String(rawText || '').trim();
  const numericIndex = Number.parseInt(normalizedText, 10);
  if (/^\d+$/.test(normalizedText) && numericIndex >= 1 && numericIndex <= options.length) {
    return { matched: true, value: options[numericIndex - 1].value };
  }

  const option = options.find((item) => (
    String(item.value).trim() === normalizedText ||
    String(item.label).trim() === normalizedText
  ));
  return option
    ? { matched: true, value: option.value }
    : { matched: false, value: '' };
}

/**
 * 读取字段上的有限数字约束。
 * 输入: 字段对象和候选字段名。
 * 输出: 有限数字；无有效约束时返回 undefined。
 */
function getVariableNumericConstraint(field = {}, key = '') {
  const value = field?.[key];
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

/**
 * 计算文本字符数。
 * 输入: 用户文本。
 * 输出: 按 Unicode 字符拆分后的长度。
 */
function getTextCharacterLength(text = '') {
  return Array.from(String(text || '')).length;
}

/**
 * 将用户输入解析为当前变量字段值。
 * 输入: 字段定义和企微文本或模板卡片 eventKey。
 * 输出: { valid, value }。
 */
function parseVariableInputValue(field = {}, rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) {
    return { valid: false, value: '' };
  }

  const keyedMatch = text.match(/^([^:：]+)[:：](.+)$/);
  const normalizedText = keyedMatch && keyedMatch[1] === field.key
    ? keyedMatch[2].trim()
    : text;

  if (field.type === 'select') {
    const options = Array.isArray(field.options) ? field.options : [];
    const selected = resolveVariableOptionValue(options, normalizedText);
    return selected.matched
      ? { valid: true, value: selected.value }
      : { valid: false, value: '' };
  }

  if (field.type === 'multiSelect') {
    const options = Array.isArray(field.options) ? field.options : [];
    const parts = normalizedText
      .split(/[,\s，、;；]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) {
      return { valid: false, value: [] };
    }

    const values = [];
    const seen = new Set();
    for (const part of parts) {
      const selected = resolveVariableOptionValue(options, part);
      if (!selected.matched) {
        return { valid: false, value: [] };
      }
      const dedupKey = String(selected.value);
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        values.push(selected.value);
      }
    }

    return values.length
      ? { valid: true, value: values }
      : { valid: false, value: [] };
  }

  if (field.type === 'number') {
    const numberValue = Number(normalizedText);
    if (!Number.isFinite(numberValue)) {
      return { valid: false, value: '', invalidMessage: '输入无效，请输入数字。' };
    }
    const minValue = getVariableNumericConstraint(field, 'minValue');
    if (minValue !== undefined && numberValue < minValue) {
      return { valid: false, value: '', invalidMessage: `数字不能小于 ${minValue}，请重新填写。` };
    }
    const maxValue = getVariableNumericConstraint(field, 'maxValue');
    if (maxValue !== undefined && numberValue > maxValue) {
      return { valid: false, value: '', invalidMessage: `数字不能大于 ${maxValue}，请重新填写。` };
    }
    return { valid: true, value: numberValue };
  }

  if (field.type === 'text') {
    const maxLength = getVariableNumericConstraint(field, 'maxLength');
    if (maxLength !== undefined && getTextCharacterLength(normalizedText) > maxLength) {
      return { valid: false, value: '', invalidMessage: `输入过长，最大长度为 ${maxLength} 个字符，请重新填写。` };
    }
  }

  return { valid: true, value: normalizedText };
}

/**
 * 构建变量字段的文本兜底菜单。
 * 输入: 字段定义、可选错误提示和可配置文案。
 * 输出: 可发送给企微用户的文本。
 */
function buildVariablePromptText(
  field = {},
  { invalid = false, invalidMessage = '', mediaBlocked = false, texts = DEFAULT_WORKER_MESSAGE_TEXTS } = {}
) {
  const isSelectField = field.type === 'select' || field.type === 'multiSelect';
  const title = isSelectField
    ? `请选择${field.label || field.key}${field.type === 'multiSelect' ? '（可输入多个序号，用逗号分隔）' : ''}`
    : `请输入${field.label || field.key}`;
  const optionLines = Array.isArray(field.options)
    ? field.options.map((option, index) => `${index + 1}. ${option.label}`).join('\n')
    : '';
  return [
    invalid ? (invalidMessage || texts.variableInputInvalid || VARIABLE_INPUT_INVALID_TEXT) : '',
    mediaBlocked ? (texts.variableMediaBlocked || VARIABLE_MEDIA_BLOCKED_TEXT) : '',
    title,
    optionLines
  ].filter(Boolean).join('\n');
}

/**
 * 判断批次中是否包含媒体消息。
 * 输入: 队列批次项。
 * 输出: 任意消息带附件时返回 true。
 */
function hasQueuedMedia(items = []) {
  return items.some((item) => getDecisionMediaCount(item.decision) > 0);
}

/**
 * 创建带错误码的 Worker 错误。
 * 输入: 业务错误码、错误消息和可选底层原因。
 * 输出: 带 code/cause 的 Error 实例。
 */
function createWorkerCodedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  error.cause = cause;
  return error;
}

/**
 * 读取消息附件的媒体 ID。
 * 输入: 标准化附件和消息对象。
 * 输出: 企业微信媒体 ID；缺失返回空字符串。
 */
function getAttachmentMediaId(attachment = {}, message = {}) {
  return attachment.wecomMediaId || attachment.mediaId || message.mediaId || message.wecomMediaId || '';
}

/**
 * 统计策略决策中的媒体附件数量。
 * 输入: 消息策略决策对象。
 * 输出: 可用于队列批次媒体上限判断的数量。
 */
function getDecisionMediaCount(decision = {}) {
  return Array.isArray(decision.attachments) ? decision.attachments.length : 0;
}

/**
 * 将同一批普通消息合并成 FastGPT 输入文本。
 * 输入: 队列中的普通消息项。
 * 输出: 按到达顺序用换行拼接后的文本。
 */
function buildAggregatedFastgptText(items = []) {
  return items
    .map((item) => {
      const hasMedia = getDecisionMediaCount(item.decision) > 0;
      const decisionText = refreshQuoteFilenameContext(
        String(item.decision?.text || '').trim(),
        item.decision
      );
      if (!hasMedia) {
        return decisionText;
      }
      if (decisionText.includes(QUOTE_CONTEXT_HEADING_TEXT)) {
        return decisionText;
      }
      if (item.decision?.chatType === 'group') {
        return decisionText || String(item.message?.text || '').trim();
      }
      return String(item.message?.text || '').trim();
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * 为一次处理批次创建不可变回复上下文。
 * 输入: 企微客户端、批次首条消息和 conversationKey。
 * 输出: 群聊含唯一 streamId 的冻结上下文；单聊返回默认上下文。
 */
function createBatchReplyContext(client, message = {}, conversationKey = '') {
  const isGroup = message.chatType === 'group';
  const streamId = isGroup && typeof client?.createStreamId === 'function'
    ? client.createStreamId('group-reply')
    : '';
  return Object.freeze({
    mode: isGroup ? 'single_quoted_group' : 'default',
    anchorMessage: message,
    conversationKey: String(conversationKey || ''),
    senderId: String(message.externalUserId || ''),
    streamId
  });
}

/**
 * 使用下载解析后的引用文件名刷新 FastGPT 引用上下文。
 * 输入: 预生成 FastGPT 文本和策略决策。
 * 输出: 文件名行更新后的文本；无引用文件时返回原文本。
 */
function refreshQuoteFilenameContext(text = '', decision = {}) {
  const value = String(text || '');
  if (!value.includes(QUOTE_CONTEXT_HEADING_TEXT)) {
    return value;
  }

  const names = (Array.isArray(decision.attachments) ? decision.attachments : [])
    .filter((attachment) => (
      String(attachment.source || '').toLowerCase() === 'quote' &&
      String(attachment.kind || '').toLowerCase() === 'file'
    ))
    .map((attachment) => String(attachment.name || '').trim())
    .filter(Boolean);
  if (!names.length) {
    return value;
  }

  const filenameLine = `引用文件：${names.join('、')}`;
  if (/^引用文件：.*$/m.test(value)) {
    return value.replace(/^引用文件：.*$/m, filenameLine);
  }
  return value.replace(QUOTE_CONTEXT_HEADING_TEXT, `${QUOTE_CONTEXT_HEADING_TEXT}\n${filenameLine}`);
}

/**
 * 读取消息附件的 AES 解密密钥。
 * 输入: 标准化附件对象。
 * 输出: 企业微信媒体 AES 密钥；缺失返回空字符串。
 */
function getAttachmentAesKey(attachment = {}) {
  return attachment.aesKey || attachment.aeskey || attachment.aes_key || attachment['aes-key'] || '';
}

/**
 * 读取文件名扩展名。
 * 输入: 文件名或路径字符串。
 * 输出: 不带点的小写扩展名；缺失时返回空字符串。
 */
function getMediaExtension(name = '') {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

/**
 * 从 URL 中解析文件名。
 * 输入: 媒体 URL 和兜底名称。
 * 输出: URL 路径末段文件名；解析失败时返回兜底名称。
 */
function getNameFromUrl(url, fallback = 'media.bin') {
  try {
    const parsed = new URL(String(url || ''));
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '') || fallback;
  } catch (error) {
    return fallback;
  }
}

/**
 * 根据文件名扩展名识别媒体元数据。
 * 输入: SDK 或下载结果提供的文件名。
 * 输出: image/file 类型、标准扩展名和 MIME；无法识别时返回 null。
 */
function detectMediaMetadataFromName(name = '') {
  const extension = getMediaExtension(name);
  const metadata = MEDIA_METADATA_BY_EXTENSION[extension];
  return metadata ? { ...metadata, source: 'filename' } : null;
}

/**
 * 判断 Buffer 是否以指定字节序列开头。
 * 输入: 文件 Buffer 和字节数组。
 * 输出: 前缀匹配时返回 true。
 */
function bufferStartsWith(buffer, bytes = []) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes.length) {
    return false;
  }

  return bytes.every((byte, index) => buffer[index] === byte);
}

/**
 * 根据文件头魔数识别媒体元数据。
 * 输入: 下载解密后的文件 Buffer。
 * 输出: image/file 类型、标准扩展名和 MIME；无法识别时返回 null。
 */
function detectMediaMetadataFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

  if (buffer.slice(0, 5).toString('ascii') === '%PDF-') {
    return { ...MEDIA_METADATA_BY_EXTENSION.pdf, source: 'buffer' };
  }

  if (bufferStartsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { ...MEDIA_METADATA_BY_EXTENSION.jpg, source: 'buffer' };
  }

  if (bufferStartsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ...MEDIA_METADATA_BY_EXTENSION.png, source: 'buffer' };
  }

  const gifHeader = buffer.slice(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { ...MEDIA_METADATA_BY_EXTENSION.gif, source: 'buffer' };
  }

  if (buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return { ...MEDIA_METADATA_BY_EXTENSION.webp, source: 'buffer' };
  }

  return null;
}

/**
 * 根据 MIME 兜底识别媒体元数据。
 * 输入: 下载结果或测试构造提供的 MIME。
 * 输出: image/file 类型、标准扩展名和 MIME；无法识别时返回 null。
 */
function detectMediaMetadataFromMime(mimeType = '') {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const metadata = MEDIA_METADATA_BY_MIME[normalized];
  return metadata ? { ...metadata, source: 'mime' } : null;
}

/**
 * 判断元数据是否代表必须由文件头确认的强二进制格式。
 * 输入: 图片/PDF/文本等媒体元数据。
 * 输出: 图片或 PDF 返回 true。
 */
function isStrongBinaryMediaMetadata(metadata) {
  return metadata?.type === 'image' || metadata?.extension === 'pdf';
}

/**
 * 判断元数据是否代表仓库显式支持的 Office 格式。
 * 输入: 文件名、MIME 或文件头识别出的媒体元数据。
 * 输出: OOXML 或 OLE Office 扩展名返回 true。
 */
function isOfficeMediaMetadata(metadata) {
  return OOXML_MEDIA_EXTENSIONS.has(metadata?.extension) || OLE_MEDIA_EXTENSIONS.has(metadata?.extension);
}

/**
 * 判断字节是否具有不应按 HTML 文本解释的强二进制容器签名。
 * 输入: 下载 Buffer。
 * 输出: 图片、PDF、ZIP 或 OLE 签名命中时返回 true。
 */
function hasStrongBinarySignature(buffer) {
  return Boolean(detectMediaMetadataFromBuffer(buffer)) ||
    bufferStartsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    bufferStartsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    bufferStartsWith(buffer, [0x50, 0x4b, 0x07, 0x08]) ||
    bufferStartsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

/**
 * 判断 OOXML XML 是否声明了任务不需要且禁止处理的 DTD/实体。
 * 输入: 已受大小限制的 XML 文本。
 * 输出: 含 DOCTYPE 或 ENTITY 声明时返回 true。
 */
function hasForbiddenOoxmlXmlDeclaration(content = '') {
  return /<!\s*(?:doctype|entity)\b/i.test(String(content || ''));
}

/**
 * 从 saxes 节点读取无 namespace 的业务属性。
 * 输入: saxes 元素节点与属性 local name。
 * 输出: 精确匹配的属性值；缺失时为空字符串。
 */
function readUnqualifiedSaxesAttribute(node = {}, localName = '') {
  const attribute = Object.values(node.attributes || {}).find((item) => (
    item.local === localName && !item.prefix && !item.uri
  ));
  return String(attribute?.value || '');
}

/**
 * 通过严格 namespace-aware SAX 解析 OOXML Content Types 文档。
 * 输入: 已受大小限制的完整 XML。
 * 输出: 文档良构、无 DTD 且根 namespace 正确时返回所需直接声明；否则返回 null。
 */
function parseOoxmlContentTypesDocument(content = '') {
  const source = String(content || '');
  const expectedNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
  if (!source || hasForbiddenOoxmlXmlDeclaration(source)) return null;
  const declarations = [];
  let invalid = false;
  let rootSeen = false;
  let depth = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', () => {
    invalid = true;
  });
  parser.on('doctype', () => {
    invalid = true;
  });
  parser.on('opentag', (node) => {
    depth += 1;
    if (depth === 1) {
      if (rootSeen || node.local !== 'Types' || node.uri !== expectedNamespace) invalid = true;
      rootSeen = true;
      return;
    }
    if (depth === 2 && ['Override', 'Default'].includes(node.local) && node.uri === expectedNamespace) {
      declarations.push({
        kind: node.local,
        attributes: {
          PartName: readUnqualifiedSaxesAttribute(node, 'PartName'),
          Extension: readUnqualifiedSaxesAttribute(node, 'Extension'),
          ContentType: readUnqualifiedSaxesAttribute(node, 'ContentType')
        }
      });
    }
  });
  parser.on('closetag', () => {
    depth -= 1;
    if (depth < 0) invalid = true;
  });
  try {
    parser.write(source).close();
  } catch (error) {
    invalid = true;
  }
  if (invalid || !rootSeen || depth !== 0) return null;
  return { declarations };
}

/**
 * 按 OPC/RFC 3986 规则规范化 part name 以供等价比较。
 * 输入: 以斜杠开头的 package part name。
 * 输出: 解码未保留字符并进行 ASCII case-fold 的名称；非法 part name 返回空字符串。
 */
function normalizeOpcPartNameForComparison(partName = '') {
  const source = String(partName || '');
  if (!source.startsWith('/') || source.endsWith('/') || source.includes('\\') ||
    source.includes('//') || /[?#\u0000-\u0020]/.test(source) || /%(?![0-9A-Fa-f]{2})/.test(source)) {
    return '';
  }
  let normalized = source.replace(/%([0-9A-Fa-f]{2})/g, (match, hex) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return /[A-Za-z0-9._~-]/.test(character) ? character : match.toUpperCase();
  });
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) return '';
  normalized = normalized.replace(/[A-Z]/g, (character) => character.toLowerCase());
  return normalized;
}

/**
 * 按 ASCII 不区分大小写比较 OPC extension。
 * 输入: Content Types Extension 或 main part 扩展名。
 * 输出: 仅折叠 ASCII A-Z 后的字符串。
 */
function normalizeOpcExtension(extension = '') {
  return String(extension || '').replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/**
 * 校验 OOXML Content Types 是否声明预期主部件类型。
 * 输入: [Content_Types].xml 文本与格式要求。
 * 输出: namespace 正确且 Override 或 Default 精确匹配时返回 true。
 */
function contentTypesDeclareOoxmlMainPart(content = '', requirement = {}) {
  const document = parseOoxmlContentTypesDocument(content);
  if (!document) return false;
  const expectedContentType = String(requirement.mainContentType || '').toLowerCase();
  const expectedPart = normalizeOpcPartNameForComparison(`/${requirement.mainPart || ''}`);
  if (!expectedPart) return false;
  const overrides = document.declarations
    .filter(({ kind }) => kind === 'Override')
    .map(({ attributes }) => ({
      contentType: String(attributes.ContentType || '').toLowerCase(),
      partName: normalizeOpcPartNameForComparison(attributes.PartName)
    }));
  if (overrides.some(({ partName }) => !partName)) return false;
  const matchingOverrides = overrides.filter(({ partName }) => partName === expectedPart);
  if (matchingOverrides.length > 1) return false;
  if (matchingOverrides.length === 1) {
    return matchingOverrides[0].contentType === expectedContentType;
  }

  const extension = normalizeOpcExtension(String(requirement.mainPart || '').split('.').pop() || '');
  const matchingDefaults = document.declarations
    .filter(({ kind, attributes }) => (
      kind === 'Default' && normalizeOpcExtension(attributes.Extension) === extension
    ));
  return matchingDefaults.length === 1 &&
    String(matchingDefaults[0].attributes.ContentType || '').toLowerCase() === expectedContentType;
}

/**
 * 从 OOXML ZIP entry 读取受控文本样本。
 * 输入: yauzl reader、entry、最多捕获字节数及是否拒绝超限 entry。
 * 输出: 读取成功时解析文本；读取错误或拒绝超限时为空字符串。
 */
function readOoxmlEntryText(zipfile, entry, maxCaptureBytes, rejectOversized = false) {
  if (!entry || (rejectOversized && Number(entry.uncompressedSize || 0) > maxCaptureBytes)) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    zipfile.openReadStream(entry, (openError, stream) => {
      if (openError || !stream) {
        resolve('');
        return;
      }
      let settled = false;
      let capturedBytes = 0;
      const chunks = [];
      // 作用: 只解析一次 entry 读取结果；输入为文本；输出为完成 Promise。
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      stream.on('data', (chunk) => {
        if (capturedBytes >= maxCaptureBytes) return;
        const remaining = maxCaptureBytes - capturedBytes;
        const captured = chunk.subarray(0, remaining);
        chunks.push(captured);
        capturedBytes += captured.length;
      });
      stream.on('error', () => finish(''));
      stream.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    });
  });
}

/**
 * 校验 OOXML 主部件样本的根元素与 namespace。
 * 输入: 主部件 XML 文本与格式要求。
 * 输出: 根元素 local name 和 namespace 均精确匹配时返回 true。
 */
function hasExpectedOoxmlRoot(content = '', requirement = {}) {
  const source = String(content || '');
  if (!source || hasForbiddenOoxmlXmlDeclaration(source)) return false;
  let invalid = false;
  let root = null;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', () => {
    invalid = true;
  });
  parser.on('doctype', () => {
    invalid = true;
  });
  parser.on('opentag', (node) => {
    if (!root) root = { localName: node.local, namespace: node.uri };
  });
  try {
    parser.write(source);
  } catch (error) {
    invalid = true;
  }
  return !invalid &&
    root?.localName === requirement.rootElement &&
    root?.namespace === requirement.rootNamespace;
}

/**
 * 通过成熟 ZIP reader 校验 OOXML central directory 和格式专属入口。
 * 输入: 下载 Buffer 与 docx/xlsx/pptx 扩展名。
 * 输出: 内容类型声明与实际 canonical 主部件均匹配时解析为 true。
 */
function validateOoxmlPackage(buffer, extension) {
  const requirement = OOXML_PACKAGE_REQUIREMENTS[extension];
  if (!Buffer.isBuffer(buffer) || !requirement) return Promise.resolve(false);
  return new Promise((resolve) => {
    yauzl.fromBuffer(buffer, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
      autoClose: false
    }, (openError, zipfile) => {
      if (openError || !zipfile) {
        resolve(false);
        return;
      }
      let settled = false;
      let entryCount = 0;
      let totalUncompressedBytes = 0;
      let contentTypesEntry = null;
      let mainPartEntry = null;
      // 作用: 只完成一次 OOXML 校验并停止继续读取；输入为校验结果；输出为关闭 reader 后解析 Promise。
      const finish = (isValid) => {
        if (settled) return;
        settled = true;
        zipfile.close();
        resolve(Boolean(isValid));
      };
      zipfile.on('error', () => finish(false));
      zipfile.on('entry', (entry) => {
        entryCount += 1;
        totalUncompressedBytes += Number(entry.uncompressedSize || 0);
        if (entryCount > MAX_OUTBOUND_OFFICE_ENTRIES ||
          totalUncompressedBytes > MAX_OUTBOUND_OFFICE_UNCOMPRESSED_BYTES ||
          (entry.generalPurposeBitFlag & 0x1) !== 0) {
          finish(false);
          return;
        }
        const fileName = String(entry.fileName || '');
        if (fileName === '[Content_Types].xml') {
          if (contentTypesEntry) {
            finish(false);
            return;
          }
          contentTypesEntry = entry;
        }
        if (fileName === requirement.mainPart) {
          if (mainPartEntry) {
            finish(false);
            return;
          }
          mainPartEntry = entry;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', async () => {
        if (!contentTypesEntry || !mainPartEntry ||
          Number(contentTypesEntry.uncompressedSize || 0) <= 0 ||
          Number(mainPartEntry.uncompressedSize || 0) <= 0) {
          finish(false);
          return;
        }
        const contentTypes = await readOoxmlEntryText(
          zipfile,
          contentTypesEntry,
          MAX_OUTBOUND_OFFICE_CONTENT_TYPES_BYTES,
          true
        );
        const mainPart = await readOoxmlEntryText(
          zipfile,
          mainPartEntry,
          MAX_OUTBOUND_OFFICE_ROOT_INSPECTION_BYTES
        );
        finish(
          contentTypesDeclareOoxmlMainPart(contentTypes, requirement) &&
          hasExpectedOoxmlRoot(mainPart, requirement)
        );
      });
      zipfile.readEntry();
    });
  });
}

/**
 * 判断下载字节是否实际呈现为 HTML 文档或常见 HTML fragment。
 * 输入: 前 64 KiB UTF-8 文本样本。
 * 输出: 存在 doctype 或受支持 HTML 根/fragment 标签时返回 true。
 */
function looksLikeActualHtml(contentSample = '') {
  return /^\s*(?:<!doctype\s+html|<(?:html|head|body|form|script|style|meta|link|title|iframe|input|button|div|span|p|a|section|main|nav|table|ul|ol|li|h[1-6])\b)/i.test(contentSample) ||
    /<(?:html|head|body|form|script|iframe|input|div|section|main)\b/i.test(contentSample);
}

/**
 * 判断实际 HTML 是否为登录、认证或访问校验页。
 * 输入: 已确认含 HTML markup 的文本样本。
 * 输出: 含已知校验 marker、登录 form、密码输入或认证文案时返回 true。
 */
function looksLikeAuthenticationHtml(contentSample = '') {
  return contentSample.includes('controller/v1/public/verify') ||
    contentSample.includes('sfdomainparam') ||
    /<form\b[^>]*(?:login|auth|sign[\s_-]*in)/i.test(contentSample) ||
    /<input\b[^>]*type\s*=\s*["']?password/i.test(contentSample) ||
    (/<form\b/i.test(contentSample) &&
      /(?:login|log\s*in|sign\s*in|password|authenticate|authentication)/i.test(contentSample));
}

/**
 * 为缺少扩展名的媒体生成稳定文件名。
 * 输入: 原始文件名、识别出的媒体元数据和兜底基础名。
 * 输出: 带扩展名的文件名；无法识别扩展名时保留原文件名或使用兜底名。
 */
function buildResolvedMediaName(name = '', metadata = {}, fallbackBase = 'media') {
  const rawName = String(name || '').trim();
  if (getMediaExtension(rawName)) {
    return rawName;
  }

  const baseName = rawName.replace(/\.+$/, '') || fallbackBase;
  return metadata.extension ? `${baseName}.${metadata.extension}` : baseName;
}

/**
 * 生成长度受控的 FastGPT 出站媒体文件名。
 * 输入: URL/回复块提供的名称、已识别媒体元数据、类型兜底名和稳定命名开关。
 * 输出: 不超过约定长度且带扩展名的 OSS 上传文件名。
 */
function buildOutboundMediaUploadName(name = '', metadata = {}, fallbackBase = 'media', preferStableName = false) {
  const detectedExtension = MEDIA_METADATA_BY_EXTENSION[metadata.extension]?.extension || 'bin';
  if (preferStableName) {
    return `${fallbackBase}.${detectedExtension}`;
  }

  const originalExtension = getMediaExtension(name);
  const resolvedName = buildResolvedMediaName(name, metadata, fallbackBase);
  const hasUntrustedOriginalExtension = Boolean(originalExtension) && metadata.source !== 'filename';
  if (!hasUntrustedOriginalExtension &&
    resolvedName.length <= MAX_OUTBOUND_MEDIA_NAME_LENGTH &&
    getMediaExtension(resolvedName)) {
    return resolvedName;
  }

  return `${fallbackBase}.${detectedExtension}`;
}

/**
 * 执行默认 DNS 查询。
 * 输入: 主机名和 Node lookup 选项。
 * 输出: dns.promises.lookup 的地址记录。
 */
function defaultOutboundDnsLookup(hostname, options = {}) {
  return dns.promises.lookup(hostname, options);
}

/**
 * 把 IPv4 地址转为无符号整数。
 * 输入: 标准点分十进制 IPv4。
 * 输出: 32 位整数；非法地址返回 null。
 */
function parseIpv4Number(address = '') {
  const parts = String(address || '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    return null;
  }
  return parts.reduce((value, part) => ((value * 256) + Number(part)) >>> 0, 0);
}

/**
 * 判断 IPv4 整数是否位于指定 CIDR。
 * 输入: 地址整数、网络整数和前缀长度。
 * 输出: 位于子网时返回 true。
 */
function isIpv4InSubnet(value, network, prefixLength) {
  const shift = 32 - prefixLength;
  return (value >>> shift) === (network >>> shift);
}

/**
 * 判断 IPv4 是否属于非公网、保留或组播范围。
 * 输入: 标准 IPv4 地址。
 * 输出: 不应被出站下载访问时返回 true。
 */
function isBlockedIpv4Address(address = '') {
  const value = parseIpv4Number(address);
  if (value === null) return true;
  const blockedCidrs = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ];
  return blockedCidrs.some(([network, prefixLength]) => (
    isIpv4InSubnet(value, parseIpv4Number(network), prefixLength)
  ));
}

/**
 * 把 IPv6 地址解析为 128 位整数。
 * 输入: 压缩或完整 IPv6，可包含 IPv4 尾段。
 * 输出: BigInt；非法地址返回 null。
 */
function parseIpv6Number(address = '') {
  let value = String(address || '').replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const ipv4Tail = value.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Tail) {
    const ipv4 = parseIpv4Number(ipv4Tail[1]);
    if (ipv4 === null) return null;
    value = `${value.slice(0, value.length - ipv4Tail[1].length)}${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) + BigInt(parseInt(group, 16)), 0n);
}

/**
 * 判断 IPv6 整数是否位于指定 CIDR。
 * 输入: 地址整数、网络地址和前缀长度。
 * 输出: 位于子网时返回 true。
 */
function isIpv6InSubnet(value, networkAddress, prefixLength) {
  const network = parseIpv6Number(networkAddress);
  if (network === null) return false;
  const shift = 128n - BigInt(prefixLength);
  return (value >> shift) === (network >> shift);
}

/**
 * 判断 IPv6 是否属于非公网、保留、组播或 IPv4 映射私网。
 * 输入: 标准 IPv6 地址。
 * 输出: 不应被出站下载访问时返回 true。
 */
function isBlockedIpv6Address(address = '') {
  const value = parseIpv6Number(address);
  if (value === null) return true;
  if ((value >> 32n) === 0xffffn) {
    const mapped = Number(value & 0xffffffffn);
    const mappedAddress = [24, 16, 8, 0]
      .map((shift) => String((mapped >>> shift) & 0xff))
      .join('.');
    return isBlockedIpv4Address(mappedAddress);
  }
  const isGlobalUnicast = (value >> 125n) === 1n;
  if (!isGlobalUnicast) return true;
  return [
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20]
  ].some(([network, prefixLength]) => isIpv6InSubnet(value, network, prefixLength));
}

/**
 * 判断解析后的 IP 是否可作为公网出站目标。
 * 输入: IPv4 或 IPv6 字符串。
 * 输出: 公网单播地址返回 true。
 */
function isSafeOutboundIpAddress(address = '') {
  const normalized = String(address || '').replace(/^\[|\]$/g, '');
  const family = net.isIP(normalized);
  if (family === 4) return !isBlockedIpv4Address(normalized);
  if (family === 6) return !isBlockedIpv6Address(normalized);
  return false;
}

/**
 * 判断 IP 是否可供 FastGPT 出站媒体下载使用。
 * 输入: IPv4 或 IPv6 字符串。
 * 输出: 语法有效的任意 IPv4 或 IPv6 地址返回 true。
 */
function isAllowedFastgptOutboundIpAddress(address = '') {
  const normalized = String(address || '').replace(/^\[|\]$/g, '');
  return net.isIP(normalized) !== 0;
}

/**
 * 归一化 DNS lookup 的单条或多条结果。
 * 输入: 字符串、记录对象或记录数组。
 * 输出: 带 address/family 的非空记录数组。
 */
function normalizeDnsLookupRecords(result) {
  const values = Array.isArray(result) ? result : [result];
  return values
    .map((item) => {
      const address = typeof item === 'string' ? item : item?.address;
      const family = Number(typeof item === 'object' ? item?.family : net.isIP(address));
      return address ? { address: String(address), family: family || net.isIP(address) } : null;
    })
    .filter(Boolean);
}

/**
 * 校验 URL 协议、字面 IP 或全部 DNS 答案。
 * 输入: URL 对象、可注入 DNS lookup 和 FastGPT 私网放开策略。
 * 输出: 已验证的地址记录；不安全时抛出稳定阻断错误。
 */
async function validateSafeOutboundUrl(parsedUrl, dnsLookup, { allowPrivateNetwork = false } = {}) {
  if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw createWorkerCodedError('FASTGPT_MEDIA_URL_BLOCKED', 'FastGPT media URL is blocked');
  }
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(hostname);
  let records;
  if (literalFamily) {
    records = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      records = normalizeDnsLookupRecords(await dnsLookup(hostname, { all: true, verbatim: true }));
    } catch (error) {
      throw createWorkerCodedError('FASTGPT_MEDIA_URL_UNREADABLE', 'FastGPT media URL is unreadable', error);
    }
  }
  const isAllowedAddress = allowPrivateNetwork
    ? isAllowedFastgptOutboundIpAddress
    : isSafeOutboundIpAddress;
  if (!records.length || records.some((record) => !isAllowedAddress(record.address))) {
    throw createWorkerCodedError('FASTGPT_MEDIA_URL_BLOCKED', 'FastGPT media URL is blocked');
  }
  return records;
}

/**
 * 创建会在实际 socket 解析时再次校验 DNS 的 lookup。
 * 输入: 可注入 DNS lookup 和 FastGPT 私网放开策略。
 * 输出: 兼容 http.Agent 的安全 lookup 回调函数。
 */
function createSafeOutboundLookup(dnsLookup, { allowPrivateNetwork = false } = {}) {
  // 作用: 解析并校验请求实际连接所用地址；输入为主机、lookup 选项和回调；输出为安全地址或稳定错误。
  return function safeOutboundLookup(hostname, options, callback) {
    const lookupOptions = typeof options === 'number' ? { family: options } : { ...(options || {}) };
    Promise.resolve(dnsLookup(hostname, {
      ...lookupOptions,
      all: true,
      verbatim: true
    })).then((result) => {
      const records = normalizeDnsLookupRecords(result);
      const isAllowedAddress = allowPrivateNetwork
        ? isAllowedFastgptOutboundIpAddress
        : isSafeOutboundIpAddress;
      if (!records.length || records.some((record) => !isAllowedAddress(record.address))) {
        throw createWorkerCodedError('FASTGPT_MEDIA_URL_BLOCKED', 'FastGPT media URL is blocked');
      }
      if (lookupOptions.all) {
        callback(null, records);
        return;
      }
      callback(null, records[0].address, records[0].family);
    }).catch((error) => callback(
      error?.code === 'FASTGPT_MEDIA_URL_BLOCKED'
        ? error
        : createWorkerCodedError('FASTGPT_MEDIA_URL_UNREADABLE', 'FastGPT media URL is unreadable', error)
    ));
  };
}

/**
 * 允许 Axios 把成功和重定向响应交给 Worker 自行处理。
 * 输入: HTTP 状态码。
 * 输出: 2xx/3xx 返回 true。
 */
function acceptOutboundDownloadStatus(status) {
  return Number(status) >= 200 && Number(status) < 400;
}

/**
 * 判断 URL 是否为 FastGPT 签名文件接口。
 * 输入: FastGPT 回复中的媒体 URL。
 * 输出: 路径包含 /api/system/file/ 时返回 true。
 */
function isFastgptSystemFileUrl(url = '') {
  try {
    return new URL(String(url || '')).pathname.toLowerCase().includes('/api/system/file/');
  } catch (error) {
    return false;
  }
}

/**
 * 规范化 HTTP(S) URL 的 origin。
 * 输入: 配置或候选 URL。
 * 输出: URL 标准 origin；非法协议、凭据或 URL 返回空字符串。
 */
function normalizeHttpOrigin(url = '') {
  try {
    const parsed = new URL(String(url || ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch (error) {
    return '';
  }
}

/**
 * 生成 FastGPT 媒体下载候选地址。
 * 输入: 回复中的媒体 URL 和绑定配置的 FastGPT API 基础地址。
 * 输出: 携带 reply/configured source 和受信 origin 的去重候选数组。
 */
function buildFastgptMediaDownloadCandidates(url = '', apiBaseUrl = '') {
  const originalUrl = String(url || '').trim();
  if (!originalUrl) {
    return [];
  }

  const trustedOrigin = normalizeHttpOrigin(apiBaseUrl);
  const originalOrigin = normalizeHttpOrigin(originalUrl);
  const originalIsConfiguredSystemFile = Boolean(trustedOrigin) &&
    originalOrigin === trustedOrigin &&
    isFastgptSystemFileUrl(originalUrl);
  const candidates = [{
    url: originalUrl,
    source: originalIsConfiguredSystemFile ? 'configured_api_origin' : 'reply_url',
    trustedOrigin: originalIsConfiguredSystemFile ? trustedOrigin : ''
  }];
  try {
    const parsedUrl = new URL(originalUrl);
    const parsedBaseUrl = new URL(String(apiBaseUrl || ''));
    if (trustedOrigin && parsedUrl.origin !== trustedOrigin && isFastgptSystemFileUrl(originalUrl)) {
      const directUrl = new URL(`${parsedUrl.pathname}${parsedUrl.search}`, `${parsedBaseUrl.origin}/`).toString();
      if (normalizeHttpOrigin(directUrl) === trustedOrigin) {
        candidates.push({
          url: directUrl,
          source: 'configured_api_origin',
          trustedOrigin: ''
        });
      }
    }
  } catch (error) {
    return candidates;
  }

  return candidates.filter((candidate, index) => (
    candidates.findIndex((item) => item.url === candidate.url) === index
  ));
}

/**
 * 判断 FastGPT 下载结果是否可作为出站媒体。
 * 输入: 回复媒体块、下载字节和响应 MIME。
 * 输出: 非空、非认证页且扩展名/MIME/文件头互相一致时返回 true。
 */
async function isValidOutboundMediaPayload(block = {}, buffer, mimeType = '') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return false;
  }

  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const contentSample = buffer
    .subarray(0, Math.min(buffer.length, MAX_OUTBOUND_MEDIA_INSPECTION_BYTES))
    .toString('utf8')
    .toLowerCase();
  const strongBinarySignature = hasStrongBinarySignature(buffer);
  const actualHtml = !strongBinarySignature && looksLikeActualHtml(contentSample);
  const authenticationHtml = actualHtml && looksLikeAuthenticationHtml(contentSample);
  const blockType = String(block.type || '').toLowerCase();
  const mediaUrl = block.url || block.ossUrl || '';
  const declaredName = block.name || block.filename || getNameFromUrl(mediaUrl, '');
  const nameMetadata = detectMediaMetadataFromName(declaredName);
  const bufferMetadata = detectMediaMetadataFromBuffer(buffer);
  const mimeMetadata = detectMediaMetadataFromMime(normalizedMimeType);
  const nameOfficeMetadata = isOfficeMediaMetadata(nameMetadata) ? nameMetadata : null;
  const mimeOfficeMetadata = isOfficeMediaMetadata(mimeMetadata) ? mimeMetadata : null;
  const explicitHtmlFile = ['html', 'htm'].includes(getMediaExtension(declaredName));
  const explicitTextFile = ['txt', 'md', 'html', 'htm', 'csv'].includes(getMediaExtension(declaredName));
  if (explicitHtmlFile || normalizedMimeType === 'text/html') {
    return blockType !== 'image' &&
      explicitHtmlFile &&
      normalizedMimeType === 'text/html' &&
      !strongBinarySignature &&
      actualHtml &&
      !authenticationHtml;
  }
  if (actualHtml) return false;

  if (nameOfficeMetadata || mimeOfficeMetadata) {
    if (blockType === 'image') return false;
    if (nameMetadata && !nameOfficeMetadata) return false;
    if (mimeMetadata && !mimeOfficeMetadata) return false;
    if (nameOfficeMetadata && mimeOfficeMetadata &&
      nameOfficeMetadata.extension !== mimeOfficeMetadata.extension) return false;
    const officeMetadata = nameOfficeMetadata || mimeOfficeMetadata;
    if (OLE_MEDIA_EXTENSIONS.has(officeMetadata.extension)) return false;
    return validateOoxmlPackage(buffer, officeMetadata.extension);
  }

  if (bufferMetadata) {
    if (blockType === 'image' && bufferMetadata.type !== 'image') return false;
    if (blockType === 'file' && bufferMetadata.type === 'image') return false;
    if (nameMetadata && nameMetadata.extension !== bufferMetadata.extension) return false;
    if (mimeMetadata && mimeMetadata.extension !== bufferMetadata.extension) return false;
    return true;
  }

  if (isStrongBinaryMediaMetadata(nameMetadata) || isStrongBinaryMediaMetadata(mimeMetadata)) {
    return false;
  }
  if (explicitTextFile) {
    return !mimeMetadata || mimeMetadata.type === 'file';
  }
  if (nameMetadata?.type === 'file') {
    return !mimeMetadata || mimeMetadata.type === 'file';
  }
  return blockType !== 'image' && Boolean(mimeMetadata?.type === 'file');
}

/**
 * 解析下载后的入站媒体类型。
 * 输入: 原附件、下载结果和企微消息类型。
 * 输出: FastGPT 所需的 image/file 类型、文件名、MIME 和识别来源。
 */
function resolveDownloadedMedia({ attachment = {}, downloaded = {}, messageType = '' } = {}) {
  const originalKind = String(attachment.kind || messageType || 'file').toLowerCase();
  const originalName = downloaded.filename || downloaded.name || attachment.name || attachment.filename || attachment.originalName || '';
  const originalMimeType = downloaded.mimeType || downloaded.mimetype || attachment.mimeType || attachment.mimetype || '';
  const metadata = detectMediaMetadataFromName(originalName) ||
    detectMediaMetadataFromBuffer(downloaded.buffer) ||
    detectMediaMetadataFromMime(originalMimeType) ||
    {
      type: originalKind === 'image' ? 'image' : 'file',
      extension: getMediaExtension(originalName),
      mimeType: originalMimeType,
      source: 'messageType'
    };
  const fallbackBase = metadata.type === 'image' ? 'image' : 'file';

  return {
    type: metadata.type,
    filename: buildResolvedMediaName(originalName, metadata, fallbackBase),
    mimeType: metadata.mimeType || originalMimeType,
    extension: metadata.extension,
    source: metadata.source
  };
}

/**
 * 解析 FastGPT 出站媒体元数据。
 * 输入: 回复媒体块和已下载内容。
 * 输出: 可用于 OSS 上传和企业微信发送的文件名、类型和 MIME。
 */
function resolveOutboundMedia({ block = {}, downloaded = {} } = {}) {
  const blockType = String(block.type || 'file').toLowerCase();
  const fallbackBase = blockType === 'image' ? 'image' : 'file';
  const mediaUrl = block.url || block.ossUrl;
  const providedName = block.name || block.filename;
  const urlDerivedName = getNameFromUrl(mediaUrl, '');
  const signedFileUrl = isFastgptSystemFileUrl(mediaUrl);
  const hasExplicitName = Boolean(providedName) && (!signedFileUrl || providedName !== urlDerivedName);
  const originalName = providedName || urlDerivedName || `${fallbackBase}.bin`;
  const originalMimeType = downloaded.mimeType || block.mimeType || '';
  const metadata = detectMediaMetadataFromName(originalName) ||
    detectMediaMetadataFromBuffer(downloaded.buffer) ||
    detectMediaMetadataFromMime(originalMimeType) ||
    {
      type: blockType === 'image' ? 'image' : 'file',
      extension: getMediaExtension(originalName),
      mimeType: originalMimeType,
      source: 'replyBlock'
    };

  return {
    type: blockType === 'image' ? 'image' : metadata.type,
    filename: buildOutboundMediaUploadName(
      originalName,
      metadata,
      fallbackBase,
      signedFileUrl && !hasExplicitName
    ),
    mimeType: metadata.mimeType || originalMimeType,
    extension: metadata.extension,
    source: metadata.source
  };
}

/**
 * 构造安全的媒体下载消息上下文。
 * 输入: 标准化企业微信消息。
 * 输出: 不包含 raw payload 和敏感密钥的消息摘要。
 */
function buildSafeMediaDownloadMessage(message = {}) {
  return {
    messageId: message.messageId || '',
    messageType: message.messageType || '',
    externalUserId: message.externalUserId || '',
    chatType: message.chatType || '',
    chatId: message.chatId || '',
    mediaId: message.mediaId || message.wecomMediaId || ''
  };
}

/**
 * 构造企业微信媒体下载请求。
 * 输入: 附件、绑定、消息和媒体上下文。
 * 输出: 保留不可枚举 aesKey 的下载参数对象。
 */
function buildMediaDownloadRequest({ attachment = {}, binding, message, mediaId, messageType } = {}) {
  const request = {
    ...attachment,
    binding,
    message: buildSafeMediaDownloadMessage(message),
    mediaId,
    messageType
  };
  const aesKey = getAttachmentAesKey(attachment);
  if (aesKey) {
    Object.defineProperty(request, 'aesKey', {
      value: aesKey,
      enumerable: false,
      configurable: true
    });
  }

  return request;
}

/**
 * 生成媒体回复文本链接。
 * 输入: 回复块类型、URL 和名称。
 * 输出: 可在企业微信中点击的文本链接。
 */
function buildReplyMediaLink({ url, name }) {
  return String(url || name || '').trim();
}

/**
 * 合并相邻的文本回复块。
 * 输入: text/image/file 回复块数组。
 * 输出: 保留媒体顺序且相邻文本只发送一次的回复块数组。
 */
function mergeAdjacentTextReplyBlocks(blocks = []) {
  const merged = [];
  for (const block of blocks) {
    if (block?.type === 'text') {
      const text = String(block.text || '').trim();
      if (!text) {
        continue;
      }

      const previous = merged[merged.length - 1];
      if (previous?.type === 'text') {
        previous.text = `${previous.text}\n${text}`;
        continue;
      }

      merged.push({ ...block, text });
      continue;
    }

    merged.push(block);
  }

  return merged;
}

/**
 * 归一化 FastGPT 回复块。
 * 输入: 适配器响应中的 replyBlocks 或兼容旧字段。
 * 输出: text/image/file 回复块数组。
 */
function normalizeReplyBlocks(response = {}) {
  const blocks = Array.isArray(response.replyBlocks) ? [...response.replyBlocks] : [];
  const replyText = String(response.replyText || '').trim();
  const blockText = blocks
    .filter((block) => block?.type === 'text')
    .map((block) => String(block.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (replyText && replyText !== blockText && !blocks.some((block) => block.type === 'text' && String(block.text || '').trim() === replyText)) {
    blocks.unshift({ type: 'text', text: replyText });
  }
  if (response.image_url) {
    const url = String(response.image_url || '').trim();
    blocks.push({ type: 'image', url, name: getNameFromUrl(url, 'image') });
  }
  if (response.file_url) {
    const url = String(response.file_url || '').trim();
    blocks.push({ type: 'file', url, name: response.fileName || response.filename || getNameFromUrl(url, 'file') });
  }

  return mergeAdjacentTextReplyBlocks(blocks.filter((block) => {
    if (!block?.type) {
      return false;
    }
    if (block.type === 'form') {
      return Array.isArray(block.fields) && block.fields.length;
    }
    return block.text || block.url;
  }));
}

/**
 * 把新旧 FastGPT 回复统一成原始 Markdown 与结构化媒体。
 * 输入: FastGPT 适配器响应。
 * 输出: 包含 markdown 和 structuredMedia 的 replyDocument。
 */
function normalizeReplyDocument(response = {}) {
  if (response.replyDocument && typeof response.replyDocument === 'object') {
    return {
      markdown: String(response.replyDocument.markdown || ''),
      structuredMedia: Array.isArray(response.replyDocument.structuredMedia)
        ? response.replyDocument.structuredMedia
        : []
    };
  }

  const blocks = normalizeReplyBlocks(response);
  return {
    markdown: blocks
      .filter((block) => block.type === 'text')
      .map((block) => String(block.text || ''))
      .filter(Boolean)
      .join('\n'),
    structuredMedia: blocks
      .filter((block) => block.type === 'image' || block.type === 'file')
      .map((block) => ({
        type: block.type,
        url: block.url,
        alt: block.alt || '',
        name: block.name || ''
      }))
  };
}

/**
 * 企业微信 Bot 长连接 Worker。
 * 输入: 绑定配置、解密 Secret、租约调度器、SDK 客户端和 Worker ID。
 * 输出: 可启动、停止和受租约保护发送回复的 Worker 实例。
 */
class WecomBotWorker {
  /**
   * 创建企业微信 Bot Worker。
   * 输入: binding、secret、workerId、client、scheduler、messageHandler。
   * 输出: 尚未启动的 Worker 实例。
   */
  constructor({
    binding,
    secret,
    workerId,
    client = new WecomAibotClient(),
    scheduler,
    messageHandler = null,
    policyService = createWecomMessagePolicyService(),
    dedupService = createWecomBotDedupService(),
    fastgptAdapter = new FastgptBotAdapter(),
    userBindingService = createWecomUserBindingService(),
    appPermissionService = createFastgptAppPermissionService(),
    mediaStorageService = createWecomMediaStorageService(),
    mediaDownloader = client,
    ossUploader = mediaStorageService,
    outboundDownloader = axios,
    outboundDnsLookup = defaultOutboundDnsLookup,
    outboundMediaConcurrency = DEFAULT_OUTBOUND_MEDIA_CONCURRENCY,
    inboundQueueService = createWecomInboundQueueService(),
    config = wecomBotConfig,
    logger = defaultLogger(),
    now = defaultNow,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  }) {
    this.binding = binding;
    this.secret = secret;
    this.workerId = workerId;
    this.client = client;
    this.scheduler = scheduler;
    this.messageHandler = messageHandler;
    this.policyService = policyService;
    this.dedupService = dedupService;
    this.fastgptAdapter = fastgptAdapter;
    this.userBindingService = userBindingService;
    this.appPermissionService = appPermissionService;
    this.mediaDownloader = mediaDownloader || client;
    this.ossUploader = ossUploader || mediaStorageService;
    this.outboundDownloader = outboundDownloader;
    this.outboundDnsLookup = outboundDnsLookup;
    this.outboundMediaConcurrency = resolvePositiveInteger(
      outboundMediaConcurrency,
      DEFAULT_OUTBOUND_MEDIA_CONCURRENCY
    );
    this.inboundQueueService = inboundQueueService;
    this.config = config;
    this.messageTexts = resolveWorkerMessageTexts(config);
    this.maxReplyLength = resolvePositiveInteger(config?.message?.maxReplyLength, MAX_WECOM_REPLY_LENGTH);
    this.streamingConfig = resolveStreamingConfig(config);
    this.logger = logger;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.state = createWecomBotWorkerStateMachine();
    this.stopped = false;
    this.replyLeaseLost = false;
    this.serverDisconnectRecoveryTimer = null;
    this.serverDisconnectRecoveryAttempts = 0;
    this.serverDisconnectRecoveryInFlight = false;
    this.serverDisconnectAuthenticationTimer = null;
    this.serverDisconnectAuthenticationAttempt = null;
  }

  /**
   * 构建 SDK 连接回调，供首次启动和主动恢复复用。
   * 输入: 无。
   * 输出: 包含 Bot 凭证和生命周期处理器的连接参数。
   */
  createClientConnectionOptions() {
    return {
      botId: this.binding.botId,
      secret: this.secret,
      onMessage: (message) => this.handleMessage(message),
      onError: (error) => this.handleClientError(error),
      onClose: () => this.handleClientReconnecting({ code: 'ECONNRESET', message: 'connection closed' }),
      onAuthenticated: () => this.handleClientAuthenticated(),
      onReconnecting: (attempt) => this.handleClientReconnecting({
        code: 'WECOM_SDK_RECONNECTING',
        message: `reconnecting attempt ${attempt}`
      }),
      onDisconnected: (reason) => this.handleClientDisconnected(reason)
    };
  }

  /**
   * 启动企业微信 SDK 连接并订阅消息。
   * 输入: 无。
   * 输出: 当前 Worker 实例；连接成功后状态更新为 connected。
   */
  async start() {
    const botId = this.binding.botId;
    this.state.transition('starting');

    try {
      await this.client.connect(this.createClientConnectionOptions());
      return this;
    } catch (error) {
      if (this.state.current() !== 'stopped') {
        this.state.transition('failed');
      }
      await this.scheduler.updateStatusIfLeaseHeld(botId, this.workerId, {
        status: 'failed',
        lastError: summarizeWorkerError(error)
      });
      throw error;
    }
  }

  /**
   * 处理 SDK 入站消息。
   * 输入: 标准化后的企业微信消息。
   * 输出: 消息处理结果；本阶段只委托可注入处理器，消息闭环在后续阶段实现。
   */
  async handleMessage(message) {
    if (typeof this.messageHandler !== 'function') {
      return this.processInboundMessage(message);
    }

    return this.messageHandler(message, this);
  }

  /**
   * 处理企业微信入站消息并完成 FastGPT 转发闭环。
   * 输入: 标准化后的企业微信消息。
   * 输出: 处理动作结果，用于测试和日志。
   */
  async processInboundMessage(message) {
    const startedAt = this.now();
    const bindingId = toIdString(this.binding._id || this.binding.id || this.binding.bindingId);
    const decision = this.policyService.evaluate({
      binding: this.binding,
      message
    });
    const messageId = decision.messageId || toIdString(message?.messageId || message?.id || `${Date.now()}`);
    const inboundLogMeta = {
      bindingId,
      botId: this.binding.botId,
      workerId: this.workerId,
      messageId,
      action: decision.action,
      forwardToFastgpt: Boolean(decision.forwardToFastgpt),
      reason: decision.reason || '',
      textLength: String(message?.text || '').length
    };

    if (decision.action === 'ignore') {
      writeStructuredLog(this.logger, 'info', '[WeComBotWorker] inbound message received', inboundLogMeta);
      writeStructuredLog(this.logger, 'info', '[WeComBotWorker] inbound message ignored', {
        bindingId,
        messageId,
        reason: decision.reason,
        durationMs: this.now() - startedAt
      });
      return {
        action: 'ignored',
        reason: decision.reason,
        messageId
      };
    }

    const dedupStartedAt = this.now();
    const dedup = await this.dedupService.createProcessingRecord(bindingId, messageId);
    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] dedup check finished', {
      bindingId,
      messageId,
      created: Boolean(dedup.created),
      degraded: Boolean(dedup.degraded),
      durationMs: this.now() - dedupStartedAt
    });
    if (!dedup.created) {
      return {
        action: 'duplicate',
        messageId
      };
    }

    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] inbound message received', inboundLogMeta);

    if (!decision.forwardToFastgpt && decision.action !== 'reset_conversation') {
      if (decision.replyText) {
        try {
          const replyContext = createBatchReplyContext(this.client, message, decision.conversationKey);
          await this.sendReplyContextFinalOrThrow(replyContext, decision.replyText);
          await this.dedupService.markCompleted(bindingId, messageId);
        } catch (error) {
          await this.recordReplyFailure(bindingId, messageId, error);
          return {
            action: 'failed',
            reason: error?.code === 'WECOM_MEDIA_REPLY_FAILED'
              ? 'WECOM_MEDIA_REPLY_FAILED'
              : 'WECOM_REPLY_FAILED',
            messageId
          };
        }
      } else {
        await this.dedupService.markCompleted(bindingId, messageId);
      }

      return {
        action: decision.action,
        reason: decision.reason,
        messageId
      };
    }

    try {
      return await this.inboundQueueService.enqueue({
        conversationKey: decision.conversationKey,
        kind: decision.action === 'reset_conversation' ? 'barrier' : 'normal',
        message,
        decision,
        chatType: decision.chatType,
        chatId: decision.chatId,
        externalUserId: decision.externalUserId,
        bindingId,
        messageId,
        startedAt,
        mediaCount: getDecisionMediaCount(decision)
      }, (batch) => this.processQueuedInboundBatch(batch));
    } catch (error) {
      writeStructuredLog(this.logger, 'warn', '[WeComBotWorker] inbound message failed', {
        bindingId,
        messageId,
        durationMs: this.now() - startedAt,
        error: sanitizeWorkerErrorSummary(error)
      });
      await this.dedupService.markFailed(
        bindingId,
        messageId,
        createSanitizedWorkerError(error, 'WECOM_REPLY_FAILED')
      );
      await this.scheduler.updateStatusIfLeaseHeld(this.binding.botId, this.workerId, {
        status: this.state.current(),
        lastError: sanitizeWorkerErrorSummary(error)
      });
      try {
        const replyContext = createBatchReplyContext(this.client, message, decision.conversationKey);
        await this.sendReplyContextFinalOrThrow(replyContext, this.messageTexts.fastgptFailure, {
          contentKinds: ['fallback']
        });
      } catch (replyError) {
        await this.recordReplyFailure(bindingId, messageId, replyError);
      }

      return {
        action: 'failed',
        reason: classifyInboundFailureReason(error),
        messageId
      };
    }
  }

  /**
   * 处理同一会话 Key 下的队列批次。
   * 输入: 队列服务交付的普通聚合批次或屏障批次。
   * 输出: 每条原始消息对应的处理结果。
   */
  async processQueuedInboundBatch(batch = {}) {
    const items = Array.isArray(batch.items) ? batch.items : [];
    if (!items.length) {
      return { itemResults: [] };
    }
    const first = items[0];
    const replyContext = createBatchReplyContext(
      this.client,
      first.message,
      first.decision?.conversationKey
    );

    try {
      if (batch.kind === 'barrier' || first.decision?.action === 'reset_conversation') {
        const result = await this.processQueuedResetItem(first, replyContext);
        return { itemResults: [result] };
      }

      return await this.processQueuedForwardBatch(items, replyContext);
    } catch (error) {
      await this.recordQueuedFailure(items, error, { replyContext });
      return {
        itemResults: items.map((item) => ({
          action: 'failed',
          reason: classifyInboundFailureReason(error),
          messageId: item.messageId
        }))
      };
    }
  }

  /**
   * 查询队列批次对应的企业微信用户绑定。
   * 输入: 批次中的首条消息项。
   * 输出: 用户绑定服务返回的绑定状态。
   */
  async findBoundUserForQueuedItem(item) {
    const bindingLookupStartedAt = this.now();
    const boundUser = await this.userBindingService.findBoundUserByWecomId(item.decision.externalUserId);
    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] user binding lookup finished', {
      bindingId: item.bindingId,
      messageId: item.messageId,
      conversationKey: maskConversationKey(item.decision.conversationKey),
      bound: Boolean(boundUser?.bound),
      hasUsername: Boolean(boundUser?.username),
      durationMs: this.now() - bindingLookupStartedAt
    });

    return boundUser;
  }

  /**
   * 合并并发送群聊重置后的确认、欢迎语和首个变量字段。
   * 输入: 重置队列项、绑定用户、FastGPT 重置结果和批次回复上下文。
   * 输出: reset_conversation 处理结果；只发送一个群聊引用气泡。
   */
  async finishGroupResetItem({ item, boundUser, resetResult, replyContext }) {
    const welcomeText = String(resetResult?.welcomeText || '').trim();
    let formContent = '';
    if (welcomeText) {
      if (typeof this.fastgptAdapter.clearBindingWelcomePending === 'function') {
        await this.fastgptAdapter.clearBindingWelcomePending({
          binding: this.binding,
          conversationKey: item.decision.conversationKey
        });
      }
      const schema = await this.loadAppVariableSchema();
      const fields = Array.isArray(schema.fields) ? schema.fields : [];
      const currentState = await this.loadConversationVariableState(item.decision.conversationKey);
      const variableValues = applyVariableDefaults(fields, {
        ...(currentState?.variableValues || {})
      });
      const missingIndex = findNextMissingVariableFieldIndex(fields, variableValues);
      if (missingIndex >= 0) {
        const pendingVariableForm = buildPendingVariableForm({
          fields,
          currentIndex: missingIndex,
          source: 'appConfig',
          schemaHash: schema.schemaHash || ''
        });
        formContent = await this.prepareVariablePrompt({
          first: item,
          boundUser,
          field: fields[missingIndex],
          variableValues,
          pendingVariableForm,
          variableSchemaHash: schema.schemaHash || ''
        });
      }
    }

    await this.sendReplyContextFinalOrThrow(replyContext, joinReplySections([
      item.decision.replyText,
      formatWelcomeSection(welcomeText),
      formContent
    ]), {
      form: Boolean(formContent),
      contentKinds: [
        'text',
        welcomeText ? 'welcome' : '',
        formContent ? 'form' : ''
      ].filter(Boolean)
    });
    await this.markQueuedItemsCompleted([item]);
    return { action: 'reset_conversation', messageId: item.messageId };
  }

  /**
   * 处理会话重置屏障消息。
   * 输入: 单条 reset_conversation 队列项和批次回复上下文。
   * 输出: 该 messageId 的处理结果。
   */
  async processQueuedResetItem(item, replyContext) {
    const boundUser = await this.findBoundUserForQueuedItem(item);
    if (!boundUser?.bound) {
      const replyText = getAuthRequiredReplyText(item, boundUser, this.config);
      if (replyText) {
        const replyResult = await this.sendSingleQueuedReply({
          items: [item],
          replyContext,
          text: replyText
        });
        if (replyResult) {
          return replyResult;
        }
      }
      await this.markQueuedItemsCompleted([item]);
      return {
        action: 'auth_required',
        messageId: item.messageId
      };
    }

    const permissionDeniedResult = await this.shortCircuitIfAppUseDenied([item], boundUser, replyContext);
    if (permissionDeniedResult) {
      return permissionDeniedResult.itemResults?.[0] || {
        action: 'permission_denied',
        reason: 'APP_USE_PERMISSION_REQUIRED',
        messageId: item.messageId
      };
    }

    const resetStartedAt = this.now();
    const resetResult = await this.fastgptAdapter.resetBindingConversation({
      binding: this.binding,
      externalUserId: boundUser.wecomUserId || item.decision.externalUserId,
      conversationKey: item.decision.conversationKey,
      fastgptUserId: boundUser.username
    });
    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] FastGPT conversation reset finished', {
      bindingId: item.bindingId,
      messageId: item.messageId,
      durationMs: this.now() - resetStartedAt
    });

    if (replyContext.mode === 'single_quoted_group') {
      return this.finishGroupResetItem({
        item,
        boundUser,
        resetResult,
        replyContext
      });
    }

    const replyResult = await this.sendSingleQueuedReply({
      items: [item],
      replyContext,
      text: item.decision.replyText
    });
    if (replyResult) {
      return replyResult;
    }

    const welcomeText = String(resetResult?.welcomeText || '').trim();
    if (welcomeText) {
      const welcomeReplyResult = await this.sendSingleQueuedReply({
        items: [item],
        replyContext,
        text: welcomeText
      });
      if (welcomeReplyResult) {
        return welcomeReplyResult;
      }

      if (typeof this.fastgptAdapter.clearBindingWelcomePending === 'function') {
        await this.fastgptAdapter.clearBindingWelcomePending({
          binding: this.binding,
          conversationKey: item.decision.conversationKey
        });
      }

      const schema = await this.loadAppVariableSchema();
      const currentState = await this.loadConversationVariableState(item.decision.conversationKey);
      await this.promptOpeningAppConfigFormAfterWelcome({
        items: [item],
        boundUser,
        replyContext,
        schema,
        currentState,
        markCompleted: false
      });
    }

    await this.markQueuedItemsCompleted([item]);
    return {
      action: 'reset_conversation',
      messageId: item.messageId
    };
  }

  /**
   * 处理普通可转发消息聚合批次。
   * 输入: 同一 conversationKey 的普通消息项和批次回复上下文。
   * 输出: 批次中每条 messageId 的处理结果。
   */
  async processQueuedForwardBatch(items, replyContext) {
    const first = items[0];
    const boundUser = await this.findBoundUserForQueuedItem(first);
    if (!boundUser?.bound) {
      const replyText = getAuthRequiredReplyText(first, boundUser, this.config);
      if (replyText) {
        const replyResult = await this.sendSingleQueuedReply({
          items,
          replyContext,
          text: replyText
        });
        if (replyResult) {
          return { itemResults: items.map(() => replyResult) };
        }
      }
      await this.markQueuedItemsCompleted(items);
      return {
        itemResults: items.map((item) => ({
          action: 'auth_required',
          messageId: item.messageId
        }))
      };
    }

    const permissionDeniedResult = await this.shortCircuitIfAppUseDenied(items, boundUser, replyContext);
    if (permissionDeniedResult) {
      return permissionDeniedResult;
    }

    const variableResult = (
      typeof this.fastgptAdapter.getAppVariableSchema === 'function' ||
      typeof this.fastgptAdapter.getConversationVariableState === 'function'
    )
      ? await this.prepareVariablesBeforeForward(items, boundUser, replyContext)
      : { shouldContinue: true, variables: {} };
    if (!variableResult.shouldContinue) {
      return variableResult.response;
    }
    const variables = variableResult.variables;
    let fastgptText = Object.prototype.hasOwnProperty.call(variableResult, 'text')
      ? variableResult.text
      : buildAggregatedFastgptText(items);

    const media = [];
    for (const item of items) {
      const itemMedia = await this.prepareInboundMedia({
        message: item.message,
        decision: item.decision,
        boundUser,
        bindingId: item.bindingId,
        messageId: item.messageId
      });
      media.push(...itemMedia);
    }
    if (!Object.prototype.hasOwnProperty.call(variableResult, 'text')) {
      fastgptText = buildAggregatedFastgptText(items);
    }

    if (this.shouldUseStreamingReply()) {
      return this.processQueuedStreamingForwardBatch(
        items,
        boundUser,
        media,
        variables,
        fastgptText,
        replyContext
      );
    }

    const fastgptStartedAt = this.now();
    const response = await this.fastgptAdapter.sendBindingMessage({
      binding: this.binding,
      text: fastgptText,
      media,
      variables,
      externalUserId: boundUser.wecomUserId || first.decision.externalUserId,
      conversationKey: first.decision.conversationKey,
      fastgptUserId: boundUser.username
    });
    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] FastGPT forwarding finished', {
      bindingId: first.bindingId,
      messageId: first.messageId,
      messageIds: items.map((item) => item.messageId),
      durationMs: this.now() - fastgptStartedAt,
      conversationIdPresent: Boolean(response.conversationId),
      replyTextLength: String(response.replyText || '').length,
      replyBlockCount: Array.isArray(response.replyBlocks) ? response.replyBlocks.length : 0
    });

    const welcomeText = String(response.welcomeText || '').trim();
    if (welcomeText && replyContext.mode !== 'single_quoted_group') {
      const replyResult = await this.sendSingleQueuedReply({
        items,
        replyContext,
        text: welcomeText
      });
      if (replyResult) {
        return { itemResults: items.map(() => replyResult) };
      }
    }

    const replyBlocks = normalizeReplyBlocks(response);
    const runtimeFormBlock = getFormReplyBlock(replyBlocks);
    if (runtimeFormBlock) {
      if (replyContext.mode === 'single_quoted_group') {
        const formContent = await this.prepareRuntimeFormContent({
          items,
          boundUser,
          formBlock: runtimeFormBlock
        });
        const textContent = getTextFromReplyBlocks(replyBlocks);
        await this.sendReplyContextFinalOrThrow(replyContext, joinReplySections([
          formatWelcomeSection(welcomeText),
          textContent,
          formContent
        ]), {
          form: true,
          contentKinds: [
            welcomeText ? 'welcome' : '',
            textContent ? 'text' : '',
            'form'
          ].filter(Boolean)
        });
        await this.markQueuedItemsCompleted(items);
        return {
          itemResults: items.map((item) => ({
            action: 'variable_prompt',
            reason: 'RUNTIME_VARIABLE_FORM',
            messageId: item.messageId
          }))
        };
      }
      const runtimeFormResult = await this.handleRuntimeFormReplyBlocks(items, boundUser, replyContext, replyBlocks);
      if (runtimeFormResult) {
        return runtimeFormResult;
      }
    }
    const replyDocument = normalizeReplyDocument(response);
    if (!String(replyDocument.markdown || '').trim() && !replyDocument.structuredMedia.length) {
      writeStructuredLog(this.logger, 'warn', '[WeComBotWorker] FastGPT returned no reply blocks', {
        bindingId: first.bindingId,
        messageId: first.messageId,
        messageIds: items.map((item) => item.messageId),
        conversationIdPresent: Boolean(response.conversationId),
        replyTextLength: String(response.replyText || '').length
      });
      const replyResult = await this.sendSingleQueuedReply({
        items,
        replyContext,
        text: replyContext.mode === 'single_quoted_group'
          ? joinReplySections([
            formatWelcomeSection(welcomeText),
            this.messageTexts.emptyFastgptReply
          ])
          : this.messageTexts.emptyFastgptReply
      });
      if (replyResult) {
        return { itemResults: items.map(() => replyResult) };
      }
    } else {
      try {
        const outboundMessage = {
          ...first.message,
          conversationKey: first.message?.conversationKey || first.decision?.conversationKey || ''
        };
        const prepared = await this.prepareOutboundReply(outboundMessage, replyDocument);
        const delivery = await this.sendPreparedReplyIfLeaseHeld(replyContext, prepared, {
          welcomeText,
          privateMessage: outboundMessage
        });
        if (!delivery.completed) {
          throw createWorkerCodedError('WECOM_REPLY_FAILED', 'WeCom prepared reply lease lost');
        }
      } catch (error) {
        await this.recordBatchReplyFailure(items, error);
        return {
          itemResults: items.map((item) => ({
            action: 'failed',
            reason: error?.code === 'WECOM_MEDIA_REPLY_FAILED'
              ? 'WECOM_MEDIA_REPLY_FAILED'
              : 'WECOM_REPLY_FAILED',
            messageId: item.messageId
          }))
        };
      }
    }

    await this.markQueuedItemsCompleted(items);
    return {
      itemResults: items.map((item) => ({
        action: 'replied',
        messageId: item.messageId
      }))
    };
  }

  /**
   * 校验队列批次的 FastGPT 应用使用权。
   * 输入: 批次消息项和企业微信绑定用户。
   * 输出: 权限服务标准结果；缺少服务或异常时返回拒绝。
   */
  async checkAppUsePermissionForQueuedBatch(items, boundUser) {
    const first = items[0] || {};
    const startedAt = this.now();
    const appId = toIdString(this.binding.appId);
    let result;

    try {
      if (!this.appPermissionService || typeof this.appPermissionService.canUseFastgptApp !== 'function') {
        result = { allowed: false, reason: 'PERMISSION_SERVICE_UNAVAILABLE' };
      } else {
        result = await this.appPermissionService.canUseFastgptApp(
          appId,
          buildAppUsePermissionUserInfo(boundUser)
        );
      }
    } catch (error) {
      result = { allowed: false, reason: 'PERMISSION_QUERY_FAILED' };
    }

    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] app use permission check finished', {
      bindingId: first.bindingId,
      appId,
      messageId: first.messageId,
      messageIds: items.map((item) => item.messageId),
      conversationKey: maskConversationKey(first.decision?.conversationKey),
      username: maskDiagnosticValue(boundUser?.username),
      allowed: Boolean(result?.allowed),
      reason: result?.reason || '',
      durationMs: this.now() - startedAt
    });

    return result;
  }

  /**
   * 在应用使用权拒绝时短路队列批次。
   * 输入: 批次消息项、绑定用户、权限结果和批次回复上下文。
   * 输出: 每条 messageId 的 permission_denied 结果。
   */
  async rejectQueuedAppUsePermission(items, boundUser, permissionResult, replyContext) {
    const replyResult = await this.sendSingleQueuedReply({
      items,
      replyContext,
      text: this.messageTexts.appPermissionDenied
    });
    if (replyResult) {
      return {
        itemResults: items.map((item) => ({
          ...replyResult,
          messageId: item.messageId
        }))
      };
    }

    writeStructuredLog(this.logger, 'warn', '[WeComBotWorker] app use permission denied', {
      bindingId: items[0]?.bindingId,
      appId: toIdString(this.binding.appId),
      messageId: items[0]?.messageId,
      messageIds: items.map((item) => item.messageId),
      conversationKey: maskConversationKey(items[0]?.decision?.conversationKey),
      username: maskDiagnosticValue(boundUser?.username),
      reason: permissionResult?.reason || 'PERMISSION_DENIED'
    });

    await this.markQueuedItemsCompleted(items);
    return {
      itemResults: items.map((item) => ({
        action: 'permission_denied',
        reason: 'APP_USE_PERMISSION_REQUIRED',
        messageId: item.messageId
      }))
    };
  }

  /**
   * 检查应用使用权并在拒绝时短路。
   * 输入: 批次消息项、企业微信绑定用户和批次回复上下文。
   * 输出: 拒绝结果对象；允许时返回 null。
   */
  async shortCircuitIfAppUseDenied(items, boundUser, replyContext) {
    const permissionResult = await this.checkAppUsePermissionForQueuedBatch(items, boundUser);
    if (permissionResult?.allowed) {
      return null;
    }

    return this.rejectQueuedAppUsePermission(items, boundUser, permissionResult, replyContext);
  }

  /**
   * 读取应用变量 schema。
   * 输入: 当前绑定应用。
   * 输出: 归一化字段和 schema hash；适配器不支持时返回空 schema。
   */
  async loadAppVariableSchema() {
    if (typeof this.fastgptAdapter.getAppVariableSchema !== 'function') {
      return { fields: [], schemaHash: '' };
    }

    return this.fastgptAdapter.getAppVariableSchema(toIdString(this.binding.appId));
  }

  /**
   * 读取当前 FastGPT 应用欢迎语。
   * 输入: 可选应用变量 schema，优先复用其中的 app 记录。
   * 输出: 去除首尾空白后的欢迎文本；缺失时返回空字符串。
   */
  async loadAppWelcomeText(schema = {}) {
    const schemaWelcomeText = String(schema?.app?.chatConfig?.welcomeText || '').trim();
    if (schemaWelcomeText) {
      return schemaWelcomeText;
    }

    if (typeof this.fastgptAdapter.getAppWelcomeText === 'function') {
      return String(await this.fastgptAdapter.getAppWelcomeText(toIdString(this.binding.appId)) || '').trim();
    }

    return '';
  }

  /**
   * 读取会话变量状态。
   * 输入: 绑定用户和 conversationKey。
   * 输出: 当前变量状态；适配器不支持时返回空状态。
   */
  async loadConversationVariableState(conversationKey) {
    if (typeof this.fastgptAdapter.getConversationVariableState !== 'function') {
      return {
        variableValues: {},
        pendingVariableForm: null,
        variableSchemaHash: '',
        lastVariablePromptAt: null
      };
    }

    return this.fastgptAdapter.getConversationVariableState({
      binding: this.binding,
      conversationKey
    });
  }

  /**
   * 保存会话变量状态。
   * 输入: 批次首项、绑定用户和变量状态。
   * 输出: 适配器保存结果；适配器不支持时返回 null。
   */
  async saveConversationVariableState(first, boundUser, state) {
    if (typeof this.fastgptAdapter.saveConversationVariableState !== 'function') {
      return null;
    }

    return this.fastgptAdapter.saveConversationVariableState({
      binding: this.binding,
      externalUserId: boundUser.wecomUserId || first.decision.externalUserId,
      conversationKey: first.decision.conversationKey,
      fastgptUserId: boundUser.username,
      ...state
    });
  }

  /**
   * 构建变量提示并保存 pending 表单状态。
   * 输入: 批次首项、绑定用户、字段和变量状态。
   * 输出: 表单字段 Markdown；发送策略由调用方按聊天类型决定。
   */
  async prepareVariablePrompt({
    first,
    boundUser,
    field,
    variableValues,
    pendingVariableForm,
    variableSchemaHash,
    invalid = false,
    invalidMessage = '',
    mediaBlocked = false
  }) {
    const promptText = buildVariablePromptText(field, {
      invalid,
      invalidMessage,
      mediaBlocked,
      texts: this.messageTexts
    });
    await this.saveConversationVariableState(first, boundUser, {
      variableValues,
      pendingVariableForm,
      variableSchemaHash,
      lastVariablePromptAt: new Date()
    });
    return promptText;
  }

  /**
   * 发送变量字段提示并保存 pending 状态。
   * 输入: 批次项、绑定用户、批次回复上下文、字段和状态。
   * 输出: variable_prompt 结果；群聊只结束一个引用气泡，单聊保持原发送方式。
   */
  async promptVariableField({
    items,
    boundUser,
    replyContext,
    field,
    variableValues,
    pendingVariableForm,
    variableSchemaHash,
    reason = '',
    invalid = false,
    invalidMessage = '',
    mediaBlocked = false,
    prefaceText = '',
    markCompleted = true
  }) {
    const first = items[0];
    const promptText = await this.prepareVariablePrompt({
      first,
      boundUser,
      field,
      variableValues,
      pendingVariableForm,
      variableSchemaHash,
      invalid,
      invalidMessage,
      mediaBlocked
    });
    if (replyContext.mode === 'single_quoted_group') {
      await this.sendReplyContextFinalOrThrow(
        replyContext,
        joinReplySections([formatWelcomeSection(prefaceText), promptText]),
        {
          form: true,
          contentKinds: [prefaceText ? 'welcome' : '', 'form'].filter(Boolean)
        }
      );
    } else {
      if (prefaceText) {
        await this.sendTextChunksIfLeaseHeld(first.message, prefaceText);
      }
      await this.sendTextChunksIfLeaseHeld(first.message, promptText);
    }

    if (markCompleted) {
      await this.markQueuedItemsCompleted(items);
    }
    return {
      itemResults: items.map((item) => ({
        action: 'variable_prompt',
        reason: reason || (invalid ? 'INVALID_VARIABLE_INPUT' : ''),
        messageId: item.messageId
      }))
    };
  }

  /**
   * 在欢迎语之后立即提示开场变量表单。
   * 输入: 队列项、绑定用户、变量 schema 和已有变量状态。
   * 输出: 已发送表单时返回 true；无表单或无需提示时返回 false。
   */
  async promptOpeningAppConfigFormAfterWelcome({
    items,
    boundUser,
    replyContext,
    schema = {},
    currentState = null,
    prefaceText = '',
    markCompleted = false
  } = {}) {
    const appFields = Array.isArray(schema.fields) ? schema.fields : [];
    if (!appFields.length) {
      return false;
    }

    let variableValues = currentState?.variableValues && typeof currentState.variableValues === 'object'
      ? { ...currentState.variableValues }
      : {};
    variableValues = applyVariableDefaults(appFields, variableValues);
    const missingIndex = findNextMissingVariableFieldIndex(appFields, variableValues);
    if (missingIndex < 0) {
      return false;
    }

    const pendingForm = buildPendingVariableForm({
      fields: appFields,
      currentIndex: missingIndex,
      source: 'appConfig',
      schemaHash: schema.schemaHash || ''
    });
    await this.promptVariableField({
      items,
      boundUser,
      replyContext,
      field: appFields[missingIndex],
      variableValues,
      pendingVariableForm: pendingForm,
      variableSchemaHash: schema.schemaHash || '',
      reason: 'WELCOME_VARIABLE_FORM',
      prefaceText,
      markCompleted
    });

    return true;
  }

  /**
   * 在媒体和 FastGPT 调用前处理变量收集状态。
   * 输入: 普通队列批次、绑定用户和批次回复上下文。
   * 输出: shouldContinue=false 表示已提示用户并短路；true 时返回可传给 FastGPT 的 variables。
   */
  async prepareVariablesBeforeForward(items, boundUser, replyContext) {
    if (typeof this.fastgptAdapter.getAppVariableSchema !== 'function' &&
      typeof this.fastgptAdapter.getConversationVariableState !== 'function') {
      return { shouldContinue: true, variables: {} };
    }

    const first = items[0];
    const schema = await this.loadAppVariableSchema();
    const appFields = Array.isArray(schema.fields) ? schema.fields : [];
    const schemaHash = schema.schemaHash || '';
    const currentState = await this.loadConversationVariableState(first.decision.conversationKey);
    const hadVariableState = Boolean(
      currentState.pendingVariableForm ||
      Object.keys(currentState.variableValues || {}).length ||
      currentState.lastVariablePromptAt
    );
    let variableValues = currentState.variableValues && typeof currentState.variableValues === 'object'
      ? { ...currentState.variableValues }
      : {};
    let pendingVariableForm = currentState.pendingVariableForm || null;
    let schemaChanged = false;

    if (appFields.length && currentState.variableSchemaHash && currentState.variableSchemaHash !== schemaHash) {
      variableValues = {};
      pendingVariableForm = null;
      schemaChanged = true;
    }

    if (pendingVariableForm) {
      const currentField = getPendingCurrentField(pendingVariableForm);
      if (!currentField) {
        pendingVariableForm = null;
      } else if (hasQueuedMedia(items)) {
        return {
          shouldContinue: false,
          response: await this.promptVariableField({
            items,
            boundUser,
            replyContext,
            field: currentField,
            variableValues,
            pendingVariableForm,
            variableSchemaHash: pendingVariableForm.schemaHash || schemaHash,
            reason: 'PENDING_VARIABLE_FORM',
            mediaBlocked: true
          })
        };
      } else {
        const parsed = parseVariableInputValue(currentField, first.decision.text || first.message?.text || first.message?.eventKey || '');
        if (!parsed.valid) {
          return {
            shouldContinue: false,
            response: await this.promptVariableField({
              items,
              boundUser,
              replyContext,
              field: currentField,
              variableValues,
              pendingVariableForm,
              variableSchemaHash: pendingVariableForm.schemaHash || schemaHash,
              reason: 'INVALID_VARIABLE_INPUT',
              invalid: true,
              invalidMessage: parsed.invalidMessage || ''
            })
          };
        }

        variableValues[currentField.key] = parsed.value;
        const pendingFields = Array.isArray(pendingVariableForm.fields) ? pendingVariableForm.fields : [];
        const nextIndex = findNextMissingVariableFieldIndex(
          pendingFields,
          variableValues,
          (Number.isInteger(pendingVariableForm.currentIndex) ? pendingVariableForm.currentIndex : 0) + 1
        );
        if (nextIndex >= 0) {
          const nextPendingForm = buildPendingVariableForm({
            fields: pendingFields,
            currentIndex: nextIndex,
            source: pendingVariableForm.source || 'appConfig',
            schemaHash: pendingVariableForm.schemaHash || schemaHash
          });
          return {
            shouldContinue: false,
            response: await this.promptVariableField({
              items,
              boundUser,
              replyContext,
              field: pendingFields[nextIndex],
              variableValues,
              pendingVariableForm: nextPendingForm,
              variableSchemaHash: pendingVariableForm.schemaHash || schemaHash,
              reason: 'PENDING_VARIABLE_FORM'
            })
          };
        }

        if (isRuntimeVariableForm(pendingVariableForm)) {
          const appConfigVariables = pickAppConfigVariableValues(variableValues, appFields);
          await this.saveConversationVariableState(first, boundUser, {
            variableValues: appConfigVariables,
            pendingVariableForm: null,
            variableSchemaHash: schemaHash,
            lastVariablePromptAt: new Date()
          });
          return {
            shouldContinue: true,
            variables: appConfigVariables,
            text: JSON.stringify(variableValues)
          };
        }
        await this.saveConversationVariableState(first, boundUser, {
          variableValues,
          pendingVariableForm: null,
          variableSchemaHash: pendingVariableForm.schemaHash || schemaHash,
          lastVariablePromptAt: new Date()
        });
        if (replyContext.mode === 'single_quoted_group') {
          await this.sendReplyContextFinalOrThrow(replyContext, this.messageTexts.variablesCollected, {
            contentKinds: ['text']
          });
        } else {
          await this.sendTextChunksIfLeaseHeld(first.message, this.messageTexts.variablesCollected);
        }
        await this.markQueuedItemsCompleted(items);
        return {
          shouldContinue: false,
          response: {
            itemResults: items.map((item) => ({
              action: 'variables_collected',
              messageId: item.messageId
            }))
          }
        };
      }
    }

    if (!appFields.length) {
      return { shouldContinue: true, variables: variableValues };
    }

    variableValues = applyVariableDefaults(appFields, schemaChanged ? {} : variableValues);
    const missingIndex = findNextMissingVariableFieldIndex(appFields, variableValues);
    if (missingIndex >= 0) {
      const pendingForm = buildPendingVariableForm({
        fields: appFields,
        currentIndex: missingIndex,
        source: 'appConfig',
        schemaHash
      });
      const prefaceText = !hadVariableState
        ? await this.loadAppWelcomeText(schema)
        : '';
      return {
        shouldContinue: false,
        response: await this.promptVariableField({
          items,
          boundUser,
          replyContext,
          field: appFields[missingIndex],
          variableValues,
          pendingVariableForm: pendingForm,
          variableSchemaHash: schemaHash,
          prefaceText,
          reason: schemaChanged ? 'VARIABLE_SCHEMA_CHANGED' : 'REQUIRED_VARIABLE_MISSING'
        })
      };
    }

    if (schemaChanged) {
      await this.saveConversationVariableState(first, boundUser, {
        variableValues,
        pendingVariableForm: null,
        variableSchemaHash: schemaHash,
        lastVariablePromptAt: new Date()
      });
    }

    return { shouldContinue: true, variables: variableValues };
  }

  /**
   * 保存运行时表单并生成首字段提示。
   * 输入: 批次项、绑定用户和 FastGPT form replyBlock。
   * 输出: 已保存 pending 状态的首字段 Markdown；无有效字段时返回空字符串。
   */
  async prepareRuntimeFormContent({ items, boundUser, formBlock }) {
    const fields = Array.isArray(formBlock?.fields) ? formBlock.fields : [];
    if (!fields.length) return '';
    const first = items[0];
    const variableValues = {};
    const missingIndex = findNextMissingVariableFieldIndex(fields, variableValues);
    const currentIndex = missingIndex >= 0 ? missingIndex : 0;
    const pendingVariableForm = buildPendingVariableForm({
      fields,
      currentIndex,
      source: formBlock.source || 'runtime',
      schemaHash: `runtime:${Date.now()}`
    });
    return this.prepareVariablePrompt({
      first,
      boundUser,
      field: fields[currentIndex],
      variableValues,
      pendingVariableForm,
      variableSchemaHash: pendingVariableForm.schemaHash
    });
  }

  /**
   * 保存运行时 FastGPT 表单并向企微用户提示。
   * 输入: 批次项、绑定用户、批次回复上下文和 form replyBlock。
   * 输出: 已处理结果；没有表单时返回 null。
   */
  async handleRuntimeFormReplyBlocks(items, boundUser, replyContext, replyBlocks = []) {
    const formBlock = getFormReplyBlock(replyBlocks);
    if (!formBlock) {
      return null;
    }

    const fields = formBlock.fields || [];
    const variableValues = {};
    const missingIndex = findNextMissingVariableFieldIndex(fields, variableValues);
    const currentIndex = missingIndex >= 0 ? missingIndex : 0;
    const pendingForm = buildPendingVariableForm({
      fields,
      currentIndex,
      source: formBlock.source || 'runtime',
      schemaHash: `runtime:${Date.now()}`
    });
    return this.promptVariableField({
      items,
      boundUser,
      replyContext,
      field: fields[currentIndex],
      variableValues,
      pendingVariableForm: pendingForm,
      variableSchemaHash: pendingForm.schemaHash,
      reason: 'RUNTIME_VARIABLE_FORM'
    });
  }

  /**
   * 判断当前批次是否可走企业微信流式回复。
   * 输入: 当前 Worker 依赖和配置。
   * 输出: true 表示可使用 streamBindingMessage + replyStreamNonBlocking。
   */
  shouldUseStreamingReply() {
    if (typeof this.client.supportsStreaming === 'function' && !this.client.supportsStreaming()) {
      return false;
    }

    return Boolean(
      this.streamingConfig.enabled &&
      typeof this.fastgptAdapter.streamBindingMessage === 'function' &&
      typeof this.client.createStreamId === 'function' &&
      typeof this.client.replyStreamNonBlocking === 'function'
    );
  }

  /**
   * 处理普通可转发消息的企业微信流式回复批次。
   * 输入: 同一 conversationKey 的普通消息项、绑定用户、入站媒体、变量、文本和批次回复上下文。
   * 输出: 每条 messageId 的处理结果。
   */
  async processQueuedStreamingForwardBatch(
    items,
    boundUser,
    media = [],
    variables = {},
    text = buildAggregatedFastgptText(items),
    replyContext
  ) {
    const first = items[0];
    const streamId = replyContext.mode === 'single_quoted_group'
      ? replyContext.streamId
      : this.client.createStreamId('stream');
    const streamState = {
      streamId,
      accumulatedText: '',
      contentOverflowed: false,
      replyBlocks: [],
      replyDocument: null,
      welcomeText: '',
      lastFlushAt: this.now(),
      finished: false,
      conversationId: ''
    };

    try {
      await this.sendBatchStreamUpdateOrThrow(replyContext, {
        streamId,
        content: this.streamingConfig.thinkingPlaceholder,
        finish: false
      });
    } catch (error) {
      await this.recordBatchReplyFailure(items, error);
      return {
        itemResults: items.map((item) => ({
          action: 'failed',
          reason: 'WECOM_REPLY_FAILED',
          messageId: item.messageId
        }))
      };
    }

    const fastgptStartedAt = this.now();
    try {
      const stream = this.fastgptAdapter.streamBindingMessage({
        binding: this.binding,
        text,
        media,
        variables,
        externalUserId: boundUser.wecomUserId || first.decision.externalUserId,
        conversationKey: first.decision.conversationKey,
        fastgptUserId: boundUser.username
      });

      for await (const event of stream) {
        await this.consumeFastgptStreamEvent(replyContext, streamState, event);
      }
    } catch (error) {
      return this.finishFailedStreamingBatch(items, replyContext, streamState, error);
    }

    const runtimeFormBlock = getFormReplyBlock(streamState.replyBlocks);
    let finalContent = this.streamingConfig.runtimeFormText;
    if (runtimeFormBlock) {
      try {
        if (replyContext.mode === 'single_quoted_group') {
          const formContent = await this.prepareRuntimeFormContent({
            items,
            boundUser,
            formBlock: runtimeFormBlock
          });
          finalContent = joinReplySections([
            formatWelcomeSection(streamState.welcomeText),
            streamState.accumulatedText,
            formContent
          ]);
        }
        await this.finishBatchStreamOrThrow(replyContext, streamState, finalContent, {
          form: true,
          forceOverflow: streamState.contentOverflowed,
          contentKinds: [
            streamState.welcomeText ? 'welcome' : '',
            streamState.accumulatedText ? 'text' : '',
            'form'
          ].filter(Boolean)
        });
      } catch (error) {
        await this.recordBatchReplyFailure(items, error);
        return {
          itemResults: items.map((item) => ({
            action: 'failed',
            reason: 'WECOM_REPLY_FAILED',
            messageId: item.messageId
          }))
        };
      }
    } else {
      const replyDocument = streamState.replyDocument || {
        markdown: streamState.accumulatedText,
        structuredMedia: []
      };
      const prepared = await this.prepareOutboundReply(first.message, replyDocument);
      if (replyContext.mode === 'single_quoted_group') {
        const content = buildGroupPreparedMarkdown(prepared, streamState.welcomeText);
        try {
          await this.finishBatchStreamOrThrow(replyContext, streamState, content, {
            forceOverflow: streamState.contentOverflowed,
            contentKinds: [
              streamState.welcomeText ? 'welcome' : '',
              prepared.markdown ? 'text' : '',
              prepared.images?.length ? 'image' : '',
              prepared.files?.length ? 'file_link' : ''
            ].filter(Boolean)
          });
          finalContent = content;
        } catch (error) {
          await this.recordBatchReplyFailure(items, error);
          return {
            itemResults: items.map((item) => ({
              action: 'failed',
              reason: 'WECOM_REPLY_FAILED',
              messageId: item.messageId
            }))
          };
        }
      } else {
        const markdownChunks = splitMarkdownReply(
          prepared.markdown,
          this.streamingConfig.maxContentBytes,
          { unit: 'bytes' }
        );
        finalContent = markdownChunks[0] || this.messageTexts.emptyFastgptReply;
        let markdownFailed = false;
        let markdownChunksSent = 0;
        const markdownStartedAt = this.now();
        try {
          await this.finishBatchStreamOrThrow(replyContext, streamState, finalContent, {
            contentKinds: ['text']
          });
          markdownChunksSent = 1;
        } catch (error) {
          if (this.replyLeaseLost) {
            await this.recordBatchReplyFailure(items, error);
            return {
              itemResults: items.map((item) => ({
                action: 'failed',
                reason: 'WECOM_REPLY_FAILED',
                messageId: item.messageId
              }))
            };
          }
          markdownFailed = true;
          const errorCode = normalizeWorkerMediaErrorCode(error?.code, 'WECOM_MARKDOWN_SEND_FAILED');
          writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] outbound Markdown send failed', {
            bindingId: first.bindingId,
            messageId: first.messageId,
            stage: OUTBOUND_REPLY_STAGES.markdownSend,
            durationMs: this.now() - markdownStartedAt,
            errorCode,
            errorSummary: errorCode
          });
          const fallbackContent = prepared.fallbackMarkdown || this.messageTexts.emptyFastgptReply;
          finalContent = fallbackContent;
          try {
            await this.finishBatchStreamOrThrow(replyContext, streamState, fallbackContent, {
              contentKinds: ['fallback']
            });
          } catch (fallbackError) {
            if (this.replyLeaseLost) {
              await this.recordBatchReplyFailure(items, fallbackError);
              return {
                itemResults: items.map((item) => ({
                  action: 'failed',
                  reason: 'WECOM_REPLY_FAILED',
                  messageId: item.messageId
                }))
              };
            }
            const fallbackSent = await this.sendTextChunksIfLeaseHeld(first.message, fallbackContent);
            if (!fallbackSent) throw fallbackError;
          }
        }

        if (!markdownFailed) {
          try {
            for (const extraChunk of markdownChunks.slice(1)) {
              const sent = await this.sendTextIfLeaseHeld(first.message, extraChunk);
              if (!sent) {
                throw createWorkerCodedError('WECOM_REPLY_FAILED', 'WeCom Markdown chunk lease lost');
              }
              markdownChunksSent += 1;
            }
          } catch (error) {
            await this.recordBatchReplyFailure(items, error);
            return {
              itemResults: items.map((item) => ({
                action: 'failed',
                reason: 'WECOM_REPLY_FAILED',
                messageId: item.messageId
              }))
            };
          }
          writeStructuredLog(this.logger, 'info', '[WeComBotWorker] outbound Markdown sent', {
            bindingId: first.bindingId,
            messageId: first.messageId,
            stage: OUTBOUND_REPLY_STAGES.markdownSend,
            durationMs: this.now() - markdownStartedAt,
            chunks: markdownChunksSent
          });
        }

        try {
          if (markdownFailed) {
            await this.sendPreparedImagesIfLeaseHeld(first.message, prepared.images);
          } else {
            for (const image of prepared.images || []) {
              if (!image.materialized) {
                this.logPreparedLinkFallback(
                  first.message,
                  { ...image, type: 'image' },
                  'fastgpt',
                  image.errorCode || 'MEDIA_STORAGE_UPLOAD_FAILED',
                  1
                );
              }
            }
          }
          if (this.replyLeaseLost) {
            throw createWorkerCodedError('WECOM_REPLY_FAILED', 'WeCom fallback media lease lost');
          }
          await this.sendPreparedFilesIfLeaseHeld(first.message, prepared.files);
          if (this.replyLeaseLost) {
            throw createWorkerCodedError('WECOM_REPLY_FAILED', 'WeCom fallback file lease lost');
          }
        } catch (error) {
          await this.recordBatchReplyFailure(items, error);
          const reason = error?.code === 'WECOM_MEDIA_REPLY_FAILED'
            ? 'WECOM_MEDIA_REPLY_FAILED'
            : 'WECOM_REPLY_FAILED';
          return {
            itemResults: items.map((item) => ({
              action: 'failed',
              reason,
              messageId: item.messageId
            }))
          };
        }
      }
    }

    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] FastGPT streaming forwarding finished', {
      bindingId: first.bindingId,
      messageId: first.messageId,
      messageIds: items.map((item) => item.messageId),
      durationMs: this.now() - fastgptStartedAt,
      conversationIdPresent: Boolean(streamState.conversationId),
      replyTextLength: finalContent.length,
      replyBlockCount: streamState.replyBlocks.length
    });

    if (runtimeFormBlock && replyContext.mode !== 'single_quoted_group') {
      const runtimeFormResult = await this.handleRuntimeFormReplyBlocks(
        items,
        boundUser,
        replyContext,
        streamState.replyBlocks
      );
      if (runtimeFormResult) {
        return runtimeFormResult;
      }
    }
    if (runtimeFormBlock) {
      await this.markQueuedItemsCompleted(items);
      return {
        itemResults: items.map((item) => ({
          action: 'variable_prompt',
          reason: 'RUNTIME_VARIABLE_FORM',
          messageId: item.messageId
        }))
      };
    }

    await this.markQueuedItemsCompleted(items);
    return {
      itemResults: items.map((item) => ({
        action: 'replied',
        messageId: item.messageId
      }))
    };
  }

  /**
   * 消费 FastGPT 标准化流式事件。
   * 输入: 批次回复上下文、流式运行态和适配器事件。
   * 输出: 更新后的内存运行态；必要时覆盖更新企微流式消息。
   */
  async consumeFastgptStreamEvent(replyContext, streamState, event = {}) {
    if (!event || typeof event !== 'object') {
      return;
    }

    if (event.type === 'error') {
      throw createWorkerCodedError(event.code || 'FASTGPT_STREAM_FAILED', event.message || 'FastGPT stream failed');
    }

    if (event.type === 'welcome') {
      const welcomeText = String(event.text || '').trim();
      if (replyContext.mode === 'single_quoted_group') {
        streamState.welcomeText = welcomeText;
        return;
      }
      if (welcomeText) {
        const sent = await this.sendTextChunksIfLeaseHeld(replyContext.anchorMessage, welcomeText);
        if (!sent) {
          throw createWorkerCodedError('WECOM_REPLY_FAILED', 'WeCom welcome reply lease lost');
        }
      }
      return;
    }

    if (event.type === 'reply_blocks' && Array.isArray(event.replyBlocks)) {
      streamState.replyBlocks.push(...event.replyBlocks);
      return;
    }

    if (event.type === 'reply_document' && event.replyDocument) {
      streamState.replyDocument = event.replyDocument;
      return;
    }

    if (event.type === 'done') {
      streamState.conversationId = event.conversationId || streamState.conversationId;
      return;
    }

    if (event.type !== 'text_delta') {
      return;
    }

    const delta = String(event.text || event.delta || '');
    if (!delta) {
      return;
    }

    const combinedText = `${streamState.accumulatedText}${delta}`;
    if (Buffer.byteLength(combinedText, 'utf8') > this.streamingConfig.maxContentBytes) {
      streamState.contentOverflowed = true;
    }
    streamState.accumulatedText = appendStreamDelta(
      streamState.accumulatedText,
      delta,
      this.streamingConfig.maxContentBytes
    );
    const now = this.now();
    if (this.streamingConfig.updateIntervalMs > 0 &&
      now - streamState.lastFlushAt < this.streamingConfig.updateIntervalMs) {
      return;
    }

    const preview = buildSafeStreamPreview(
      streamState.accumulatedText,
      this.getOutboundMediaExtensionConfig()
    );
    if (preview) {
      await this.sendBatchStreamUpdateOrThrow(replyContext, {
        streamId: streamState.streamId,
        content: preview,
        finish: false
      });
    }
    streamState.lastFlushAt = now;
  }

  /**
   * 流式批次失败时用同一 streamId 收尾并记录失败。
   * 输入: 批次项、批次回复上下文、流式运行态和错误对象。
   * 输出: 每条 messageId 的 failed 结果。
   */
  async finishFailedStreamingBatch(items, replyContext, streamState, error) {
    if (error?.code === 'WECOM_REPLY_FAILED') {
      await this.recordBatchReplyFailure(items, error);
      return {
        itemResults: items.map((item) => ({
          action: 'failed',
          reason: 'WECOM_REPLY_FAILED',
          messageId: item.messageId
        }))
      };
    }

    const safeAccumulatedText = buildSafeStreamPreview(
      streamState.accumulatedText,
      this.getOutboundMediaExtensionConfig()
    );
    const failureContent = streamState.accumulatedText
      ? (safeAccumulatedText
        ? buildInterruptedStreamContent(
          safeAccumulatedText,
          this.streamingConfig.maxContentBytes,
          this.streamingConfig.interruptedText
        )
        : this.streamingConfig.interruptedText)
      : this.streamingConfig.fastgptFailureText;
    try {
      await this.finishBatchStreamOrThrow(
        replyContext,
        streamState,
        truncateUtf8Bytes(failureContent, this.streamingConfig.maxContentBytes),
        { contentKinds: ['fallback'] }
      );
    } catch (replyError) {
      await this.recordBatchReplyFailure(items, replyError);
      return {
        itemResults: items.map((item) => ({
          action: 'failed',
          reason: 'WECOM_REPLY_FAILED',
          messageId: item.messageId
        }))
      };
    }

    await this.recordQueuedFailure(items, error, {
      sendFallbackReply: false,
      replyContext
    });
    return {
      itemResults: items.map((item) => ({
        action: 'failed',
        reason: classifyInboundFailureReason(error),
        messageId: item.messageId
      }))
    };
  }

  /**
   * 在租约有效时更新批次唯一群聊气泡。
   * 输入: 批次回复上下文、内容和 finish 标记。
   * 输出: true 表示更新成功；失租时返回 false。
   */
  async sendReplyContextUpdateIfLeaseHeld(replyContext, { content, finish = false } = {}) {
    if (this.replyLeaseLost) return false;
    const leaseHeld = await this.scheduler.assertLeaseHeld(this.binding.botId, this.workerId);
    if (!leaseHeld) {
      this.replyLeaseLost = true;
      await this.client.close();
      return false;
    }
    await this.client.replyGroupBubble(replyContext.anchorMessage, {
      streamId: replyContext.streamId,
      content,
      finish
    });
    return true;
  }

  /**
   * 更新批次唯一群聊气泡并把失败转换为回复错误。
   * 输入: 批次回复上下文、内容和 finish 标记。
   * 输出: 成功时无返回值；失租或 SDK 失败时抛出稳定错误。
   */
  async sendReplyContextUpdateOrThrow(replyContext, options) {
    try {
      const sent = await this.sendReplyContextUpdateIfLeaseHeld(replyContext, options);
      if (!sent) {
        throw createWorkerCodedError('WECOM_REPLY_FAILED', 'WeCom group reply lease lost');
      }
    } catch (error) {
      if (error?.code === 'WECOM_REPLY_FAILED') throw error;
      throw createWorkerCodedError(
        'WECOM_REPLY_FAILED',
        error?.message || 'WeCom group reply failed',
        error
      );
    }
  }

  /**
   * 记录群聊单气泡发送结果。
   * 输入: 批次回复上下文和固定枚举组成的内容类型数组。
   * 输出: 无；只写入脱敏结构化日志。
   */
  logGroupSingleBubbleSent(replyContext, contentKinds = []) {
    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] group single bubble sent', {
      bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
      messageId: toIdString(replyContext.anchorMessage?.messageId || ''),
      conversationKey: maskConversationKey(replyContext.conversationKey),
      replyMode: replyContext.mode,
      streamIdPresent: Boolean(replyContext.streamId),
      contentKinds: contentKinds.filter((kind) => [
        'welcome',
        'text',
        'form',
        'image',
        'file_link',
        'fallback'
      ].includes(kind)),
      bubbleCount: 1
    });
  }

  /**
   * 发送批次最终文本并保持单聊原行为。
   * 输入: 批次回复上下文、最终文本、表单标记和固定内容类型。
   * 输出: 成功发送的气泡数量；失租时返回零。
   */
  async sendReplyContextFinalIfLeaseHeld(
    replyContext,
    content,
    { form = false, forceOverflow = false, contentKinds = ['text'] } = {}
  ) {
    if (replyContext.mode === 'single_quoted_group') {
      const fitted = fitGroupReplyContent(
        content,
        this.streamingConfig.maxContentBytes,
        { form, forceOverflow }
      );
      if (fitted.overflowed) {
        writeStructuredLog(this.logger, 'warn', '[WeComBotWorker] group reply replaced by size fallback', {
          bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
          messageId: toIdString(replyContext.anchorMessage?.messageId || ''),
          reason: fitted.reason,
          form
        });
      }
      const sent = await this.sendReplyContextUpdateIfLeaseHeld(replyContext, {
        content: fitted.content,
        finish: true
      });
      if (sent) {
        this.logGroupSingleBubbleSent(
          replyContext,
          fitted.overflowed ? ['fallback'] : contentKinds
        );
      }
      return sent ? 1 : 0;
    }
    return this.sendTextChunksIfLeaseHeld(replyContext.anchorMessage, content);
  }

  /**
   * 发送批次最终内容并把失败转换为回复错误。
   * 输入: 批次回复上下文、最终内容和可选内容元数据。
   * 输出: 成功时无返回值；未发送或 SDK 失败时抛出稳定错误。
   */
  async sendReplyContextFinalOrThrow(replyContext, content, options = {}) {
    try {
      const sent = await this.sendReplyContextFinalIfLeaseHeld(replyContext, content, options);
      if (!sent) {
        throw createWorkerCodedError('WECOM_REPLY_FAILED', 'WeCom final reply lease lost');
      }
    } catch (error) {
      if (error?.code === 'WECOM_REPLY_FAILED') throw error;
      throw createWorkerCodedError(
        'WECOM_REPLY_FAILED',
        error?.message || 'WeCom final reply failed',
        error
      );
    }
  }

  /**
   * 按聊天类型发送流式更新，群聊固定复用批次 streamId。
   * 输入: 批次回复上下文和现有流式更新参数。
   * 输出: 成功时无返回值；失租或 SDK 失败时抛出稳定错误。
   */
  async sendBatchStreamUpdateOrThrow(replyContext, options = {}) {
    if (replyContext.mode === 'single_quoted_group') {
      return this.sendReplyContextUpdateOrThrow(replyContext, {
        content: options.content,
        finish: Boolean(options.finish)
      });
    }
    return this.sendStreamUpdateOrThrow(replyContext.anchorMessage, options);
  }

  /**
   * 按聊天类型结束当前流式回复。
   * 输入: 批次上下文、流状态、最终内容和群聊内容元数据。
   * 输出: 成功时将 streamState.finished 设为 true；失败时抛出稳定错误。
   */
  async finishBatchStreamOrThrow(replyContext, streamState, content, options = {}) {
    if (replyContext.mode === 'single_quoted_group') {
      await this.sendReplyContextFinalOrThrow(replyContext, content, options);
    } else {
      await this.sendBatchStreamUpdateOrThrow(replyContext, {
        streamId: streamState.streamId,
        content,
        finish: true
      });
    }
    streamState.finished = true;
  }

  /**
   * 为队列批次发送单次文本回复。
   * 输入: 批次项、批次回复上下文和回复文本。
   * 输出: 发送失败时返回 failed 结果，成功时返回 null。
   */
  async sendSingleQueuedReply({ items, replyContext, text }) {
    try {
      await this.sendReplyContextFinalOrThrow(replyContext, text);
      return null;
    } catch (error) {
      await this.recordBatchReplyFailure(items, error);
      return {
        action: 'failed',
        reason: error?.code === 'WECOM_MEDIA_REPLY_FAILED'
          ? 'WECOM_MEDIA_REPLY_FAILED'
          : 'WECOM_REPLY_FAILED',
        messageId: items[0]?.messageId
      };
    }
  }

  /**
   * 为队列批次发送 FastGPT 回复块。
   * 输入: 批次项、企微消息上下文和回复块。
   * 输出: 发送失败时返回 failed 结果，成功时返回 null。
   */
  async sendReplyBlocksForQueuedItems(items, message, replyBlocks) {
    try {
      await this.sendReplyBlocksIfLeaseHeld({
        ...message,
        conversationKey: message?.conversationKey || items[0]?.decision?.conversationKey || ''
      }, replyBlocks);
      return null;
    } catch (error) {
      await this.recordBatchReplyFailure(items, error);
      return {
        action: 'failed',
        reason: error?.code === 'WECOM_MEDIA_REPLY_FAILED'
          ? 'WECOM_MEDIA_REPLY_FAILED'
          : 'WECOM_REPLY_FAILED',
        messageId: items[0]?.messageId
      };
    }
  }

  /**
   * 批量标记队列消息处理完成。
   * 输入: 批次队列项。
   * 输出: 所有 messageId 的幂等状态已更新。
   */
  async markQueuedItemsCompleted(items) {
    await Promise.all(items.map((item) => (
      this.dedupService.markCompleted(item.bindingId, item.messageId)
    )));
  }

  /**
   * 批量记录队列处理失败。
   * 输入: 批次队列项、错误对象、兜底开关和可选批次回复上下文。
   * 输出: 幂等状态和 Worker 错误摘要已更新，并尝试发送一次友好失败回复。
   */
  async recordQueuedFailure(items, error, { sendFallbackReply = true, replyContext = null } = {}) {
    const first = items[0] || {};
    writeStructuredLog(this.logger, 'warn', '[WeComBotWorker] inbound message failed', {
      bindingId: first.bindingId,
      messageId: first.messageId,
      messageIds: items.map((item) => item.messageId),
      durationMs: this.now() - (first.startedAt || this.now()),
      error: sanitizeWorkerErrorSummary(error)
    });
    const persistedError = createSanitizedWorkerError(error, 'WECOM_REPLY_FAILED');
    await Promise.all(items.map((item) => (
      this.dedupService.markFailed(item.bindingId, item.messageId, persistedError)
    )));
    await this.scheduler.updateStatusIfLeaseHeld(this.binding.botId, this.workerId, {
      status: this.state.current(),
      lastError: sanitizeWorkerErrorSummary(error)
    });
    if (!sendFallbackReply) {
      return;
    }
    try {
      if (replyContext?.mode === 'single_quoted_group') {
        await this.sendReplyContextFinalOrThrow(
          replyContext,
          this.messageTexts.fastgptFailure,
          { contentKinds: ['fallback'] }
        );
      } else {
        await this.sendTextChunksIfLeaseHeld(
          replyContext?.anchorMessage || first.message,
          this.messageTexts.fastgptFailure
        );
      }
    } catch (replyError) {
      await this.recordBatchReplyFailure(items, replyError);
    }
  }

  /**
   * 批量记录企业微信回复发送失败。
   * 输入: 批次队列项和发送错误。
   * 输出: 每条 messageId 均标记为 failed，Worker 状态记录错误摘要。
   */
  async recordBatchReplyFailure(items, error) {
    const persistedError = createSanitizedWorkerError(error, 'WECOM_REPLY_FAILED');
    await Promise.all(items.map((item) => (
      this.dedupService.markFailed(item.bindingId, item.messageId, persistedError)
    )));
    await this.scheduler.updateStatusIfLeaseHeld(this.binding.botId, this.workerId, {
      status: this.state.current(),
      lastError: sanitizeWorkerErrorSummary(error)
    });
  }

  /**
   * 下载并上传入站媒体。
   * 输入: 原始消息、策略决策、绑定用户和诊断字段。
   * 输出: 可交给 FastGPT 的 image/file URL 数组；无附件时返回空数组。
   */
  async prepareInboundMedia({ message, decision, boundUser, bindingId, messageId }) {
    const attachments = Array.isArray(decision.attachments) ? decision.attachments : [];
    if (!attachments.length) {
      return [];
    }

    const media = [];
    for (const [index, attachment] of attachments.entries()) {
      const messageType = attachment.kind || decision.messageType || message.messageType;
      const mediaId = getAttachmentMediaId(attachment, message);
      const downloadStartedAt = this.now();
      const downloaded = await this.mediaDownloader.downloadMedia(buildMediaDownloadRequest({
        attachment,
        binding: this.binding,
        message,
        mediaId,
        messageType
      }));
      writeStructuredLog(this.logger, 'info', '[WeComBotWorker] WeCom media downloaded', {
        bindingId,
        messageId,
        mediaKind: messageType,
        durationMs: this.now() - downloadStartedAt,
        size: downloaded?.size || downloaded?.buffer?.length || 0
      });
      const resolvedMedia = resolveDownloadedMedia({
        attachment,
        downloaded,
        messageType
      });
      if (String(attachment.source || '').toLowerCase() === 'quote' &&
        String(attachment.kind || '').toLowerCase() === 'file') {
        attachment.name = resolvedMedia.filename;
      }

      const uploadStartedAt = this.now();
      const uploaded = await this.ossUploader.uploadMedia({
        binding: this.binding,
        appId: this.binding.appId,
        bindingId,
        messageId,
        direction: 'inbound',
        kind: resolvedMedia.type,
        messageType: resolvedMedia.type,
        index,
        originalName: resolvedMedia.filename,
        filename: resolvedMedia.filename,
        mimeType: resolvedMedia.mimeType,
        size: downloaded.size || downloaded.buffer?.length || attachment.size,
        buffer: downloaded.buffer,
        source: 'wecom',
        externalUserId: boundUser.wecomUserId || decision.externalUserId,
        conversationKey: decision.conversationKey,
        fastgptUserId: boundUser.username,
        wecomMediaId: mediaId
      });
      writeStructuredLog(this.logger, 'info', '[WeComBotWorker] WeCom media uploaded', {
        bindingId,
        messageId,
        mediaKind: resolvedMedia.type,
        detectedFrom: resolvedMedia.source,
        durationMs: this.now() - uploadStartedAt,
        ossUrl: uploaded.ossUrl || uploaded.url || '',
        ossUrlHash: uploaded.ossUrlHash || ''
      });

      media.push({
        type: resolvedMedia.type,
        url: uploaded.ossUrl || uploaded.url,
        name: uploaded.name || resolvedMedia.filename,
        mimeType: uploaded.mimeType || resolvedMedia.mimeType,
        size: uploaded.size || downloaded.size || attachment.size
      });
    }

    return media;
  }

  /**
   * 记录企业微信回复发送失败。
   * 输入: 绑定 ID、企业微信 messageId 和发送错误。
   * 输出: 无返回值；会更新幂等状态和 Worker 错误摘要。
   */
  async recordReplyFailure(bindingId, messageId, error) {
    await this.dedupService.markFailed(
      bindingId,
      messageId,
      createSanitizedWorkerError(error, 'WECOM_REPLY_FAILED')
    );
    await this.scheduler.updateStatusIfLeaseHeld(this.binding.botId, this.workerId, {
      status: this.state.current(),
      lastError: sanitizeWorkerErrorSummary(error)
    });
  }

  /**
   * 处理 SDK 连接错误并映射 Worker 状态。
   * 输入: SDK 错误对象。
   * 输出: 错误分类；鉴权失败进入 failed，其他在线错误进入 reconnecting。
   */
  async handleClientError(error) {
    const classification = classifyWorkerError(error, this.config);
    const currentState = this.state.current();

    if (this.stopped || currentState === 'stopped') {
      return classification;
    }

    if (classification.category === 'auth_failed' || classification.category === 'reconnect_exhausted') {
      this.cancelServerDisconnectRecovery();
      this.cancelRecoveryAuthenticationWatchdog();
      if (currentState !== 'failed' && currentState !== 'stopped') {
        this.state.transition('failed');
      }
      await this.scheduler.updateStatusIfLeaseHeld(this.binding.botId, this.workerId, {
        status: 'failed',
        lastError: summarizeWorkerError(error)
      });
      return classification;
    }

    if (currentState === 'connected') {
      this.state.transition('reconnecting');
      await this.scheduler.updateStatusIfLeaseHeld(this.binding.botId, this.workerId, {
        status: 'reconnecting',
        lastError: summarizeWorkerError(error)
      });
    }

    return classification;
  }

  /**
   * 处理 SDK 认证成功事件并映射为已连接状态。
   * 输入: 无。
   * 输出: true 表示状态写入成功；false 表示失租并已停止。
   */
  async handleClientAuthenticated() {
    const currentState = this.state.current();
    if (this.stopped || currentState === 'stopped') {
      return false;
    }

    const isLateRecoveryAuthentication = currentState === 'reconnecting' &&
      this.serverDisconnectRecoveryAttempts > 0 &&
      this.serverDisconnectAuthenticationAttempt === null;
    if (isLateRecoveryAuthentication) {
      writeStructuredLog(this.logger, 'warn', '忽略已超时的 WeCom Bot 恢复认证事件', {
        botId: this.binding.botId,
        workerId: this.workerId
      });
      return false;
    }

    if (currentState === 'starting' || currentState === 'reconnecting') {
      this.state.transition('connected');
    }

    this.cancelServerDisconnectRecovery();
    this.cancelRecoveryAuthenticationWatchdog();
    this.serverDisconnectRecoveryAttempts = 0;
    this.serverDisconnectRecoveryInFlight = false;

    const statusUpdated = await this.scheduler.updateStatusIfLeaseHeld(this.binding.botId, this.workerId, {
      status: 'connected',
      lastConnectedAt: new Date(),
      lastError: ''
    });
    if (!statusUpdated) {
      await this.stop();
      return false;
    }

    return true;
  }

  /**
   * 处理 SDK disconnected 事件，并在服务端替换连接时启动主动恢复。
   * 输入: SDK 提供的断开原因。
   * 输出: 错误分类；服务端替换连接时同时安排受租约保护的恢复。
   */
  async handleClientDisconnected(reason) {
    const error = {
      code: 'ECONNRESET',
      message: reason || 'connection disconnected'
    };
    const classification = await this.handleClientReconnecting(error);

    if (isServerReplacementDisconnect(reason)) {
      this.cancelRecoveryAuthenticationWatchdog();
      await this.scheduleServerDisconnectRecovery();
    }

    return classification;
  }

  /**
   * 取消尚未执行的服务端断开恢复定时器。
   * 输入: 无。
   * 输出: 无；调用后不会保留待执行恢复任务。
   */
  cancelServerDisconnectRecovery() {
    if (this.serverDisconnectRecoveryTimer !== null) {
      this.clearTimeoutFn(this.serverDisconnectRecoveryTimer);
      this.serverDisconnectRecoveryTimer = null;
    }
  }

  /**
   * 取消主动恢复的认证超时看门狗。
   * 输入: 无。
   * 输出: 无；同时清除当前等待认证的恢复次数。
   */
  cancelRecoveryAuthenticationWatchdog() {
    if (this.serverDisconnectAuthenticationTimer !== null) {
      this.clearTimeoutFn(this.serverDisconnectAuthenticationTimer);
      this.serverDisconnectAuthenticationTimer = null;
    }
    this.serverDisconnectAuthenticationAttempt = null;
  }

  /**
   * 为本次主动恢复启动认证超时看门狗。
   * 输入: 当前恢复次数。
   * 输出: 定时器句柄；超时后会关闭连接并进入下一轮退避。
   */
  startRecoveryAuthenticationWatchdog(attempt) {
    this.cancelRecoveryAuthenticationWatchdog();
    const timeoutMs = resolvePositiveInteger(
      this.config?.retry?.recoveryAuthTimeoutMs,
      DEFAULT_RECOVERY_AUTH_TIMEOUT_MS
    );
    this.serverDisconnectAuthenticationAttempt = attempt;
    this.serverDisconnectAuthenticationTimer = this.setTimeoutFn(() => {
      this.serverDisconnectAuthenticationTimer = null;
      return this.handleRecoveryAuthenticationTimeout(attempt, timeoutMs);
    }, timeoutMs);
    return this.serverDisconnectAuthenticationTimer;
  }

  /**
   * 处理主动恢复迟迟未认证的情况，并推进下一次退避或失败终态。
   * 输入: 当前恢复次数和本次认证超时毫秒数。
   * 输出: true 表示已继续安排恢复，false 表示事件已过期或 Worker 已停止。
   */
  async handleRecoveryAuthenticationTimeout(attempt, timeoutMs) {
    if (
      this.stopped ||
      this.state.current() !== 'reconnecting' ||
      this.serverDisconnectAuthenticationAttempt !== attempt
    ) {
      return false;
    }

    this.serverDisconnectAuthenticationAttempt = null;
    const error = {
      code: 'ETIMEDOUT',
      message: `server disconnect recovery authentication timed out after ${timeoutMs}ms`
    };
    await this.handleClientReconnecting(error);
    writeStructuredLog(this.logger, 'warn', 'WeCom Bot 主动恢复认证超时', {
      botId: this.binding.botId,
      workerId: this.workerId,
      attempt,
      timeoutMs
    });

    try {
      await this.client.close();
    } catch (closeError) {
      writeStructuredLog(this.logger, 'warn', 'WeCom Bot 认证超时后关闭连接失败', {
        botId: this.binding.botId,
        workerId: this.workerId,
        attempt,
        error: summarizeWorkerError(closeError)
      });
    }

    if (this.stopped || this.state.current() !== 'reconnecting') {
      return false;
    }
    return this.scheduleServerDisconnectRecovery();
  }

  /**
   * 按指数退避安排一次主动恢复，并避免同一 Worker 重复排队。
   * 输入: 无。
   * 输出: true 表示已安排，false 表示无需或无法继续恢复。
   */
  async scheduleServerDisconnectRecovery() {
    const currentState = this.state.current();
    if (
      this.stopped ||
      currentState === 'stopped' ||
      currentState === 'failed' ||
      this.serverDisconnectRecoveryTimer !== null ||
      this.serverDisconnectRecoveryInFlight
    ) {
      return false;
    }

    const maxAttempts = resolvePositiveInteger(this.config?.retry?.maxAttempts, 3);
    const attempt = this.serverDisconnectRecoveryAttempts + 1;
    if (attempt > maxAttempts) {
      await this.handleClientError({
        code: 'WS_RECONNECT_EXHAUSTED',
        message: `server disconnect recovery exhausted after ${maxAttempts} attempts`
      });
      return false;
    }

    this.serverDisconnectRecoveryAttempts = attempt;
    const delayMs = calculateServerDisconnectRecoveryDelay(
      attempt,
      this.config?.retry?.baseDelayMs
    );
    writeStructuredLog(this.logger, 'warn', 'WeCom Bot 服务端断开，已安排主动恢复', {
      botId: this.binding.botId,
      workerId: this.workerId,
      attempt,
      maxAttempts,
      delayMs
    });
    this.serverDisconnectRecoveryTimer = this.setTimeoutFn(() => {
      this.serverDisconnectRecoveryTimer = null;
      return this.recoverFromServerDisconnect(attempt);
    }, delayMs);
    return true;
  }

  /**
   * 校验租约后重建 SDK 连接，失败时继续按退避策略重试。
   * 输入: 当前恢复次数。
   * 输出: true 表示已发起新连接，false 表示失租、停止或恢复失败。
   */
  async recoverFromServerDisconnect(attempt) {
    if (this.stopped || this.state.current() === 'stopped' || this.state.current() === 'failed') {
      return false;
    }

    this.serverDisconnectRecoveryInFlight = true;
    try {
      const leaseHeld = typeof this.scheduler?.assertLeaseHeld === 'function' &&
        await this.scheduler.assertLeaseHeld(this.binding.botId, this.workerId);
      if (!leaseHeld) {
        writeStructuredLog(this.logger, 'warn', 'WeCom Bot 主动恢复已取消：Worker 租约已失效', {
          botId: this.binding.botId,
          workerId: this.workerId,
          attempt
        });
        this.serverDisconnectRecoveryInFlight = false;
        await this.stop();
        return false;
      }

      await this.client.close();
      this.startRecoveryAuthenticationWatchdog(attempt);
      await this.client.connect(this.createClientConnectionOptions());
      return true;
    } catch (error) {
      this.cancelRecoveryAuthenticationWatchdog();
      const classification = await this.handleClientError(error);
      if (classification.retryable && this.state.current() === 'reconnecting') {
        this.serverDisconnectRecoveryInFlight = false;
        await this.scheduleServerDisconnectRecovery();
      }
      return false;
    } finally {
      this.serverDisconnectRecoveryInFlight = false;
    }
  }

  /**
   * 处理 SDK 重连中或断开事件并映射为重连状态。
   * 输入: SDK 重连尝试次数、断开原因或标准错误对象。
   * 输出: 错误分类；可用于测试和日志判断。
   */
  async handleClientReconnecting(event) {
    const currentState = this.state.current();
    const error = typeof event === 'object'
      ? event
      : { code: 'ECONNRESET', message: `connection reconnecting: ${event}` };
    const classification = classifyWorkerError(error, this.config);

    if (this.stopped || currentState === 'stopped' || currentState === 'failed') {
      return classification;
    }

    if (currentState === 'connected' || currentState === 'starting') {
      this.state.transition('reconnecting');
    }

    await this.scheduler.updateStatusIfLeaseHeld(this.binding.botId, this.workerId, {
      status: 'reconnecting',
      lastError: summarizeWorkerError(error)
    });

    return classification;
  }

  /**
   * 停止 Worker 并释放租约。
   * 输入: 无。
   * 输出: 无返回值；会关闭 SDK 客户端并标记 stopped。
   */
  async stop() {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.cancelServerDisconnectRecovery();
    this.cancelRecoveryAuthenticationWatchdog();
    this.serverDisconnectRecoveryInFlight = false;
    await this.client.close();
    if (this.state.current() !== 'stopped') {
      this.state.transition('stopped');
    }
    await this.scheduler.releaseLease(this.binding.botId, this.workerId);
  }

  /**
   * 在确认仍持有租约后发送文本回复。
   * 输入: 企业微信消息上下文和回复文本。
   * 输出: true 表示已发送；false 表示失租并已关闭客户端。
   */
  async sendTextIfLeaseHeld(message, text) {
    if (this.replyLeaseLost) {
      return false;
    }
    const leaseHeld = await this.scheduler.assertLeaseHeld(this.binding.botId, this.workerId);
    if (!leaseHeld) {
      this.replyLeaseLost = true;
      await this.client.close();
      return false;
    }

    await this.client.sendText(message, text);
    return true;
  }

  /**
   * 在确认租约有效后覆盖更新企业微信流式回复。
   * 输入: 企业微信消息上下文、streamId、内容和 finish 标记。
   * 输出: true 表示已更新；false 表示失租并已关闭客户端。
   */
  async sendStreamUpdateIfLeaseHeld(message, { streamId, content, finish = false }) {
    if (this.replyLeaseLost) {
      return false;
    }
    const leaseHeld = await this.scheduler.assertLeaseHeld(this.binding.botId, this.workerId);
    if (!leaseHeld) {
      this.replyLeaseLost = true;
      await this.client.close();
      return false;
    }

    await this.client.replyStreamNonBlocking(message, {
      streamId,
      content,
      finish
    });
    return true;
  }

  /**
   * 发送流式更新，失败时转换为 Worker 回复错误。
   * 输入: 企业微信消息上下文和流式更新参数。
   * 输出: 无返回值；失租或 SDK 失败时抛出带 code 的错误。
   */
  async sendStreamUpdateOrThrow(message, options) {
    try {
      const sent = await this.sendStreamUpdateIfLeaseHeld(message, options);
      if (!sent) {
        throw createWorkerCodedError('WECOM_REPLY_FAILED', 'WeCom stream reply lease lost');
      }
    } catch (error) {
      if (error?.code === 'WECOM_REPLY_FAILED') {
        throw error;
      }
      throw createWorkerCodedError('WECOM_REPLY_FAILED', error?.message || 'WeCom stream reply failed', error);
    }
  }

  /**
   * 在确认租约有效后分段发送企业微信文本回复。
   * 输入: 企业微信消息上下文和完整回复文本。
   * 输出: 已发送的片段数量；失租时提前停止。
   */
  async sendTextChunksIfLeaseHeld(message, text) {
    const startedAt = this.now();
    let sent = 0;
    const chunks = splitReplyText(text, this.maxReplyLength);
    for (const chunk of chunks) {
      const ok = await this.sendTextIfLeaseHeld(message, chunk);
      if (!ok) {
        break;
      }
      sent += 1;
    }

    this.logTextChunksSent(message, {
      startedAt,
      sent,
      planned: chunks.length,
      text
    });

    return sent;
  }

  /**
   * 记录文本分块发送阶段指标。
   * 输入: 消息上下文、开始时间、已发送数、计划数和原始文本。
   * 输出: 无；仅写入不含正文的结构化日志。
   */
  logTextChunksSent(message, { startedAt, sent, planned, text } = {}) {
    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] WeCom text chunks sent', {
      bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
      botId: this.binding.botId,
      workerId: this.workerId,
      messageId: toIdString(message?.messageId || message?.id || ''),
      durationMs: this.now() - startedAt,
      chunks: sent,
      plannedChunks: planned,
      textLength: String(text || '').length
    });
  }

  /**
   * 解析出站媒体扩展名配置。
   * 输入: Worker 配置和内置媒体元数据。
   * 输出: renderer 使用的图片、文件扩展名数组。
   */
  getOutboundMediaExtensionConfig() {
    return {
      imageExtensions: this.config?.media?.allowedImageExtensions || Object.entries(MEDIA_METADATA_BY_EXTENSION)
        .filter(([, metadata]) => metadata.type === 'image')
        .map(([extension]) => extension),
      fileExtensions: this.config?.media?.allowedFileExtensions || Object.entries(MEDIA_METADATA_BY_EXTENSION)
        .filter(([, metadata]) => metadata.type === 'file')
        .map(([extension]) => extension)
    };
  }

  /**
   * 下载并转存回复文档中的唯一媒体。
   * 输入: 企业微信消息上下文和 replyDocument。
   * 输出: 最终 Markdown、降级正文以及原生图片/文件队列。
   */
  async prepareOutboundReply(message, replyDocument = {}) {
    const parseStartedAt = this.now();
    const plan = createReplyRenderPlan({
      markdown: replyDocument.markdown,
      structuredMedia: replyDocument.structuredMedia,
      ...this.getOutboundMediaExtensionConfig()
    });
    writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] FastGPT reply document parsed', {
      bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
      messageId: toIdString(message?.messageId || message?.id || ''),
      stage: OUTBOUND_REPLY_STAGES.parse,
      durationMs: this.now() - parseStartedAt,
      mediaCount: plan.uniqueMedia.length
    });
    const resolutions = new Map();
    await mapWithConcurrency(plan.uniqueMedia, this.outboundMediaConcurrency, async (item, index) => {
      try {
        const media = await this.materializeOutboundMediaBlock(message, {
          type: item.declaredType,
          url: item.url,
          name: item.name
        }, index);
        resolutions.set(item.dedupKey || item.url, {
          ok: true,
          ...media,
          url: media.ossUrl || media.url,
          originalUrl: item.url,
          materialized: true
        });
      } catch (error) {
        const errorCode = normalizeWorkerMediaErrorCode(
          error?.code,
          'MEDIA_STORAGE_UPLOAD_FAILED'
        );
        const stage = [
          'FASTGPT_MEDIA_URL_BLOCKED',
          'FASTGPT_MEDIA_URL_UNREADABLE',
          'FASTGPT_MEDIA_CONTENT_INVALID'
        ].includes(errorCode)
          ? OUTBOUND_REPLY_STAGES.download
          : OUTBOUND_REPLY_STAGES.ossUpload;
        resolutions.set(item.dedupKey || item.url, {
          ok: false,
          type: item.declaredType,
          originalUrl: item.url,
          name: item.name,
          errorCode,
          materialized: false
        });
        writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] FastGPT media materialization failed', {
          bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
          messageId: toIdString(message?.messageId || message?.id || ''),
          mediaKind: item.declaredType || 'media',
          stage,
          errorCode,
          errorSummary: errorCode,
          fallbackUrlSource: 'fastgpt'
        });
      }
    });
    return renderReplyPlan(plan, resolutions);
  }

  /**
   * 记录已实际发送的媒体链接降级阶段。
   * 输入: 消息上下文、媒体项、URL 来源、归一错误码和发送片段数。
   * 输出: 无；未发送链接时不写日志。
   */
  logPreparedLinkFallback(message, item = {}, fallbackUrlSource, errorCode, sent) {
    if (!sent) return;
    writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] outbound media downgraded', {
      bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
      messageId: toIdString(message?.messageId || message?.id || ''),
      mediaKind: item.type || 'media',
      stage: OUTBOUND_REPLY_STAGES.linkFallback,
      reason: normalizeWorkerMediaErrorCode(errorCode, 'WECOM_NATIVE_MEDIA_SEND_FAILED'),
      fallbackUrlSource,
      ossUrlHash: item.ossUrlHash || ''
    });
  }

  /**
   * 发送 Markdown 失败后的原生图片或链接。
   * 输入: 消息上下文和图片队列。
   * 输出: 成功发送的降级气泡数量。
   */
  async sendPreparedImagesIfLeaseHeld(message, images = []) {
    let sent = 0;
    for (const image of images) {
      if (this.replyLeaseLost) return sent;
      if (!image.materialized) {
        const fallbackSent = await this.sendTextChunksIfLeaseHeld(message, image.originalUrl || image.url);
        sent += fallbackSent;
        this.logPreparedLinkFallback(
          message,
          { ...image, type: 'image' },
          'fastgpt',
          image.errorCode || 'MEDIA_STORAGE_UPLOAD_FAILED',
          fallbackSent
        );
        if (!fallbackSent) return sent;
        continue;
      }
      let nativeFallbackReason = 'WECOM_SDK_SEND_UNAVAILABLE';
      try {
        const mediaSent = await this.sendMediaBlockIfLeaseHeld(message, { ...image, type: 'image' });
        if (mediaSent === false) return sent;
        if (mediaSent === true) {
          sent += 1;
          continue;
        }
      } catch (error) {
        nativeFallbackReason = normalizeWorkerMediaErrorCode(error?.code, 'WECOM_NATIVE_MEDIA_SEND_FAILED');
        if (this.config?.media?.outboundNativeSendFallbackEnabled === false) {
          throw createWorkerCodedError('WECOM_MEDIA_REPLY_FAILED', 'WeCom media reply failed', error);
        }
      }
      const fallbackSent = await this.sendTextChunksIfLeaseHeld(message, image.url || image.originalUrl);
      sent += fallbackSent;
      this.logPreparedLinkFallback(
        message,
        { ...image, type: 'image' },
        'oss',
        nativeFallbackReason,
        fallbackSent
      );
      if (!fallbackSent) return sent;
    }
    return sent;
  }

  /**
   * 发送独立文件或文件链接。
   * 输入: 消息上下文和文件队列。
   * 输出: 成功发送的文件/链接气泡数量。
   */
  async sendPreparedFilesIfLeaseHeld(message, files = []) {
    let sent = 0;
    for (const file of files) {
      if (this.replyLeaseLost) return sent;
      if (!file.materialized) {
        const fallbackSent = await this.sendTextChunksIfLeaseHeld(message, file.originalUrl || file.url);
        sent += fallbackSent;
        this.logPreparedLinkFallback(
          message,
          { ...file, type: 'file' },
          'fastgpt',
          file.errorCode || 'MEDIA_STORAGE_UPLOAD_FAILED',
          fallbackSent
        );
        if (!fallbackSent) return sent;
        continue;
      }
      let nativeFallbackReason = 'WECOM_SDK_SEND_UNAVAILABLE';
      try {
        const mediaSent = await this.sendMediaBlockIfLeaseHeld(message, { ...file, type: 'file' });
        if (mediaSent === false) return sent;
        if (mediaSent === true) {
          sent += 1;
          continue;
        }
      } catch (error) {
        nativeFallbackReason = normalizeWorkerMediaErrorCode(error?.code, 'WECOM_NATIVE_MEDIA_SEND_FAILED');
        if (this.config?.media?.outboundNativeSendFallbackEnabled === false) {
          throw createWorkerCodedError('WECOM_MEDIA_REPLY_FAILED', 'WeCom media reply failed', error);
        }
      }
      const fallbackSent = await this.sendTextChunksIfLeaseHeld(message, file.url || file.originalUrl);
      sent += fallbackSent;
      this.logPreparedLinkFallback(
        message,
        { ...file, type: 'file' },
        'oss',
        nativeFallbackReason,
        fallbackSent
      );
      if (!fallbackSent) return sent;
    }
    return sent;
  }

  /**
   * 按聊天类型发送 prepared reply。
   * 输入: 批次回复上下文、已准备回复、可选欢迎语和单聊发送上下文。
   * 输出: 成功气泡数量及是否完整送达。
   */
  async sendPreparedReplyIfLeaseHeld(
    replyContext,
    prepared = {},
    { welcomeText = '', privateMessage = null } = {}
  ) {
    if (replyContext.mode === 'single_quoted_group') {
      const content = buildGroupPreparedMarkdown(prepared, welcomeText);
      const contentKinds = [
        welcomeText ? 'welcome' : '',
        prepared.markdown ? 'text' : '',
        prepared.images?.length ? 'image' : '',
        prepared.files?.length ? 'file_link' : ''
      ].filter(Boolean);
      const sent = await this.sendReplyContextFinalIfLeaseHeld(replyContext, content, {
        contentKinds
      });
      return { sent, completed: sent === 1 };
    }
    return this.sendPreparedReplyDefaultIfLeaseHeld(privateMessage || replyContext.anchorMessage, prepared);
  }

  /**
   * 按原有单聊策略发送非流式图文回复并在 Markdown 失败时降级。
   * 输入: 消息上下文和 prepared reply。
   * 输出: 成功气泡数量及是否完整送达；失租时 completed 为 false。
   */
  async sendPreparedReplyDefaultIfLeaseHeld(message, prepared = {}) {
    const startedAt = this.now();
    const chunks = splitMarkdownReply(prepared.markdown, this.maxReplyLength);
    let sent = 0;
    let markdownFailed = false;
    try {
      for (const chunk of chunks) {
        const ok = await this.sendTextIfLeaseHeld(message, chunk);
        if (!ok) {
          this.logTextChunksSent(message, {
            startedAt,
            sent,
            planned: chunks.length,
            text: prepared.markdown
          });
          return { sent, completed: false };
        }
        sent += 1;
      }
      this.logTextChunksSent(message, {
        startedAt,
        sent,
        planned: chunks.length,
        text: prepared.markdown
      });
      writeStructuredLog(this.logger, 'info', '[WeComBotWorker] outbound Markdown sent', {
        bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
        messageId: toIdString(message?.messageId || message?.id || ''),
        stage: OUTBOUND_REPLY_STAGES.markdownSend,
        durationMs: this.now() - startedAt,
        chunks: chunks.length
      });
    } catch (error) {
      markdownFailed = true;
      this.logTextChunksSent(message, {
        startedAt,
        sent,
        planned: chunks.length,
        text: prepared.markdown
      });
      const errorCode = sent > 0
        ? 'WECOM_MARKDOWN_PARTIAL_SEND_FAILED'
        : normalizeWorkerMediaErrorCode(error?.code, 'WECOM_MARKDOWN_SEND_FAILED');
      writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] outbound Markdown send failed', {
        bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
        messageId: toIdString(message?.messageId || message?.id || ''),
        stage: OUTBOUND_REPLY_STAGES.markdownSend,
        durationMs: this.now() - startedAt,
        errorCode,
        errorSummary: errorCode
      });
      if (sent > 0) {
        try {
          await this.client.close();
        } catch (closeError) {
          void closeError;
        }
        throw createWorkerCodedError(
          'WECOM_MARKDOWN_PARTIAL_SEND_FAILED',
          'WeCom Markdown reply failed after partial delivery',
          error
        );
      }
      sent += await this.sendTextChunksIfLeaseHeld(
        message,
        prepared.fallbackMarkdown || this.messageTexts.emptyFastgptReply
      );
    }
    if (this.replyLeaseLost) return { sent, completed: false };
    if (markdownFailed) {
      sent += await this.sendPreparedImagesIfLeaseHeld(message, prepared.images);
    } else {
      for (const image of prepared.images || []) {
        if (!image.materialized) {
          this.logPreparedLinkFallback(
            message,
            { ...image, type: 'image' },
            'fastgpt',
            image.errorCode || 'MEDIA_STORAGE_UPLOAD_FAILED',
            1
          );
        }
      }
    }
    if (this.replyLeaseLost) return { sent, completed: false };
    sent += await this.sendPreparedFilesIfLeaseHeld(message, prepared.files);
    return { sent, completed: !this.replyLeaseLost };
  }

  /**
   * 逐跳请求 FastGPT 出站媒体，统一允许所有有效 HTTP(S) 网络地址，同时保留超时、大小和跳转次数边界。
   * 输入: HTTP(S) URL 字符串或至少含 url 字段的候选对象；source/trustedOrigin 不参与地址授权。
   * 输出: 最终非重定向 Axios 响应；非法协议、地址或跳转抛出稳定错误，内容校验与 OSS 处理仍由下游执行。
   */
  async requestSafeOutboundMediaUrl(candidate = {}) {
    const candidateUrl = typeof candidate === 'string' ? candidate : candidate.url;
    let currentUrl;
    try {
      currentUrl = new URL(String(candidateUrl || ''));
    } catch (error) {
      throw createWorkerCodedError('FASTGPT_MEDIA_URL_BLOCKED', 'FastGPT media URL is blocked', error);
    }
    const sizeLimit = this.config?.message?.maxInboundMediaBytes || 5 * 1024 * 1024;
    for (let redirectCount = 0; redirectCount <= MAX_OUTBOUND_MEDIA_REDIRECTS; redirectCount += 1) {
      await validateSafeOutboundUrl(currentUrl, this.outboundDnsLookup, { allowPrivateNetwork: true });
      const safeLookup = createSafeOutboundLookup(this.outboundDnsLookup, { allowPrivateNetwork: true });
      const response = await this.outboundDownloader.get(currentUrl.toString(), {
        responseType: 'arraybuffer',
        timeout: this.config?.media?.downloadTimeoutMs || 10000,
        maxContentLength: sizeLimit,
        maxBodyLength: sizeLimit,
        maxRedirects: 0,
        proxy: false,
        validateStatus: acceptOutboundDownloadStatus,
        httpAgent: new http.Agent({ lookup: safeLookup }),
        httpsAgent: new https.Agent({ lookup: safeLookup })
      });
      const status = Number(response?.status || 200);
      if (status < 300 || status >= 400) {
        return response;
      }
      const location = response?.headers?.location;
      if (!location || redirectCount >= MAX_OUTBOUND_MEDIA_REDIRECTS) {
        throw createWorkerCodedError('FASTGPT_MEDIA_URL_UNREADABLE', 'FastGPT media URL redirect is invalid');
      }
      try {
        currentUrl = new URL(String(location), currentUrl);
      } catch (error) {
        throw createWorkerCodedError('FASTGPT_MEDIA_URL_BLOCKED', 'FastGPT media URL is blocked', error);
      }
    }
    throw createWorkerCodedError('FASTGPT_MEDIA_URL_UNREADABLE', 'FastGPT media URL redirect limit exceeded');
  }

  /**
   * 下载 FastGPT 出站媒体。
   * 输入: FastGPT 回复媒体块。
   * 输出: buffer、MIME、大小和文件名。
   */
  async downloadOutboundMediaBlock(block = {}) {
    const url = block.url || block.ossUrl;
    if (!url || !this.outboundDownloader || typeof this.outboundDownloader.get !== 'function') {
      throw createWorkerCodedError('FASTGPT_MEDIA_URL_UNREADABLE', 'FastGPT media URL is unavailable');
    }

    const candidates = buildFastgptMediaDownloadCandidates(url, this.binding?.fastgptApiBaseUrl);
    const sizeLimit = this.config?.message?.maxInboundMediaBytes || 5 * 1024 * 1024;
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const response = await this.requestSafeOutboundMediaUrl(candidate);
        const buffer = Buffer.from(response.data || '');
        const mimeType = response.headers?.['content-type'] || block.mimeType || '';
        if (buffer.length > sizeLimit || !(await isValidOutboundMediaPayload(block, buffer, mimeType))) {
          lastError = createWorkerCodedError(
            'FASTGPT_MEDIA_CONTENT_INVALID',
            'FastGPT media URL did not return valid media content'
          );
          continue;
        }

        return {
          buffer,
          size: buffer.length,
          mimeType,
          filename: block.name || block.filename || getNameFromUrl(url, `${block.type || 'media'}.bin`),
          downloadSource: candidate.source
        };
      } catch (error) {
        lastError = error?.code === 'FASTGPT_MEDIA_URL_BLOCKED'
          ? error
          : createWorkerCodedError('FASTGPT_MEDIA_URL_UNREADABLE', 'FastGPT media URL is unreadable', error);
      }
    }

    throw lastError || createWorkerCodedError('FASTGPT_MEDIA_URL_UNREADABLE', 'FastGPT media URL is unreadable');
  }

  /**
   * 将 FastGPT 出站媒体转存到 media storage。
   * 输入: 企业微信消息、媒体块和块序号。
   * 输出: 携带 OSS URL 和 buffer 的媒体块。
   */
  async materializeOutboundMediaBlock(message, block = {}, index = 0) {
    const bindingId = toIdString(this.binding._id || this.binding.id || this.binding.bindingId);
    const messageId = toIdString(message?.messageId || message?.id || `outbound-${Date.now()}`);
    const downloadStartedAt = this.now();
    const downloaded = await this.downloadOutboundMediaBlock(block);
    writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] FastGPT media downloaded', {
      bindingId,
      messageId,
      mediaKind: block.type || 'media',
      stage: OUTBOUND_REPLY_STAGES.download,
      durationMs: this.now() - downloadStartedAt,
      size: downloaded.size,
      mimeType: downloaded.mimeType,
      downloadSource: downloaded.downloadSource || 'reply_url'
    });
    const resolvedMedia = resolveOutboundMedia({ block, downloaded });
    const uploaded = await this.ossUploader.uploadMedia({
      binding: this.binding,
      appId: this.binding.appId,
      bindingId,
      messageId,
      direction: 'outbound',
      kind: resolvedMedia.type,
      messageType: resolvedMedia.type,
      index,
      originalName: resolvedMedia.filename,
      filename: resolvedMedia.filename,
      mimeType: resolvedMedia.mimeType,
      size: downloaded.size,
      buffer: downloaded.buffer,
      source: 'fastgpt',
      externalUserId: message?.externalUserId || '',
      conversationKey: message?.conversationKey || ''
    });
    const ossUrl = uploaded.ossUrl || uploaded.url;

    writeStructuredLog(this.logger, 'info', '[WeComBotWorker] FastGPT media uploaded', {
      bindingId,
      messageId,
      mediaKind: resolvedMedia.type,
      stage: OUTBOUND_REPLY_STAGES.ossUpload,
      detectedFrom: resolvedMedia.source,
      ossUrlHash: uploaded.ossUrlHash || '',
      size: uploaded.size || downloaded.size,
      mimeType: uploaded.mimeType || resolvedMedia.mimeType
    });

    return {
      ...block,
      type: resolvedMedia.type,
      url: ossUrl,
      ossUrl,
      ossUrlHash: uploaded.ossUrlHash || '',
      ossObjectKey: uploaded.ossObjectKey || uploaded.objectKey || '',
      name: uploaded.name || resolvedMedia.filename,
      mimeType: uploaded.mimeType || resolvedMedia.mimeType,
      size: uploaded.size || downloaded.size,
      buffer: downloaded.buffer
    };
  }

  /**
   * 在确认租约有效后发送企业微信媒体回复块。
   * 输入: 企业微信消息上下文和 image/file 回复块。
   * 输出: true 表示已调用原生媒体发送；false 表示失租；null 表示无可用原生能力。
   */
  async sendMediaBlockIfLeaseHeld(message, block = {}) {
    const sendMethod = block.type === 'image'
      ? this.client.sendImage
      : (block.type === 'file' ? this.client.sendFile : null);
    const logMeta = {
      bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
      messageId: toIdString(message?.messageId || message?.id || ''),
      mediaKind: block.type || 'media',
      stage: OUTBOUND_REPLY_STAGES.nativeSend,
      ossUrlHash: block.ossUrlHash || ''
    };
    if (typeof sendMethod !== 'function') {
      writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] WeCom native media send failed', {
        ...logMeta,
        errorCode: 'WECOM_SDK_SEND_UNAVAILABLE',
        errorSummary: 'WECOM_SDK_SEND_UNAVAILABLE',
        durationMs: 0
      });
      return null;
    }

    if (this.replyLeaseLost) {
      return false;
    }
    const leaseHeld = await this.scheduler.assertLeaseHeld(this.binding.botId, this.workerId);
    if (!leaseHeld) {
      this.replyLeaseLost = true;
      await this.client.close();
      return false;
    }

    const sendStartedAt = this.now();
    try {
      const result = await sendMethod.call(this.client, message, block);
      const durationMs = this.now() - sendStartedAt;
      if (result?.downgraded) {
        const errorCode = normalizeWorkerMediaErrorCode(
          result.errorCode,
          'WECOM_NATIVE_MEDIA_SEND_FAILED'
        );
        writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] WeCom native media send failed', {
          ...logMeta,
          errorCode,
          errorSummary: errorCode,
          durationMs
        });
        writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] outbound media downgraded', {
          ...logMeta,
          stage: OUTBOUND_REPLY_STAGES.linkFallback,
          reason: errorCode,
          fallbackUrlSource: 'oss'
        });
      } else {
        writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] WeCom native media sent', {
          ...logMeta,
          durationMs
        });
      }
    } catch (error) {
      const errorCode = normalizeWorkerMediaErrorCode(
        error?.code,
        'WECOM_NATIVE_MEDIA_SEND_FAILED'
      );
      writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] WeCom native media send failed', {
        ...logMeta,
        errorCode,
        errorSummary: errorCode,
        durationMs: this.now() - sendStartedAt
      });
      throw error;
    }
    return true;
  }

  /**
   * 在确认租约有效后发送 FastGPT 回复块。
   * 输入: 企业微信消息上下文和 text/image/file 回复块。
   * 输出: 已发送块数量；媒体发送能力缺失时降级为文本链接。
   */
  async sendReplyBlocksIfLeaseHeld(message, replyBlocks = []) {
    let sent = 0;
    const dedupedReplyBlocks = deduplicateReplyBlocksByMediaUrl(replyBlocks);
    const sentMaterializedMedia = new Set();
    for (const [index, block] of dedupedReplyBlocks.entries()) {
      if (block.type === 'text') {
        sent += await this.sendTextChunksIfLeaseHeld(message, block.text);
        continue;
      }

      let mediaBlock = block;
      try {
        mediaBlock = await this.materializeOutboundMediaBlock(message, block, index);
      } catch (error) {
        const errorCode = normalizeWorkerMediaErrorCode(
          error?.code,
          'MEDIA_STORAGE_UPLOAD_FAILED'
        );
        const stage = [
          'FASTGPT_MEDIA_URL_BLOCKED',
          'FASTGPT_MEDIA_URL_UNREADABLE',
          'FASTGPT_MEDIA_CONTENT_INVALID'
        ].includes(errorCode)
          ? OUTBOUND_REPLY_STAGES.download
          : OUTBOUND_REPLY_STAGES.ossUpload;
        writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] FastGPT media materialization failed', {
          bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
          messageId: toIdString(message?.messageId || message?.id || ''),
          mediaKind: block.type || 'media',
          stage,
          errorCode,
          errorSummary: errorCode,
          fallbackUrlSource: 'fastgpt'
        });
        if (this.config?.media?.outboundNativeSendFallbackEnabled === false) {
          throw error;
        }
        const fallbackText = buildReplyMediaLink(block);
        if (fallbackText) {
          const fallbackSent = await this.sendTextChunksIfLeaseHeld(message, fallbackText);
          sent += fallbackSent;
          if (fallbackSent > 0) {
            writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] outbound media downgraded', {
              bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
              messageId: toIdString(message?.messageId || message?.id || ''),
              mediaKind: block.type || 'media',
              stage: OUTBOUND_REPLY_STAGES.linkFallback,
              reason: errorCode,
              fallbackUrlSource: 'fastgpt',
              ossUrlHash: ''
            });
          }
        }
        continue;
      }

      const materializedDedupKey = getMaterializedMediaDedupKey(mediaBlock);
      if (materializedDedupKey && sentMaterializedMedia.has(materializedDedupKey)) {
        continue;
      }
      if (materializedDedupKey) {
        sentMaterializedMedia.add(materializedDedupKey);
      }

      let mediaSent = null;
      let nativeFallbackReason = 'WECOM_SDK_SEND_UNAVAILABLE';
      try {
        mediaSent = await this.sendMediaBlockIfLeaseHeld(message, mediaBlock);
      } catch (error) {
        nativeFallbackReason = normalizeWorkerMediaErrorCode(
          error?.code,
          'WECOM_NATIVE_MEDIA_SEND_FAILED'
        );
        if (this.config?.media?.outboundNativeSendFallbackEnabled === false) {
          throw createWorkerCodedError('WECOM_MEDIA_REPLY_FAILED', error?.message || 'WeCom media reply failed', error);
        }
        mediaSent = null;
      }
      if (mediaSent === true) {
        sent += 1;
        continue;
      }
      if (mediaSent === false) {
        break;
      }

      const text = buildReplyMediaLink(mediaBlock);
      if (text) {
        const fallbackSent = await this.sendTextChunksIfLeaseHeld(message, text);
        sent += fallbackSent;
        if (fallbackSent > 0) {
          writeStructuredLog(this.logger, 'debug', '[WeComBotWorker] outbound media downgraded', {
            bindingId: toIdString(this.binding._id || this.binding.id || this.binding.bindingId),
            messageId: toIdString(message?.messageId || message?.id || ''),
            mediaKind: mediaBlock.type || 'media',
            stage: OUTBOUND_REPLY_STAGES.linkFallback,
            reason: nativeFallbackReason,
            fallbackUrlSource: 'oss',
            ossUrlHash: mediaBlock.ossUrlHash || ''
          });
        }
      }
    }

    return sent;
  }
}

module.exports = {
  AUTH_FAILURE_BACKOFF_MS,
  TRANSIENT_FAILURE_BACKOFF_MS,
  WecomBotWorker,
  classifyWorkerError,
  createWecomBotWorkerStateMachine,
  sanitizeWorkerErrorSummary,
  splitReplyText,
  summarizeWorkerError
};
