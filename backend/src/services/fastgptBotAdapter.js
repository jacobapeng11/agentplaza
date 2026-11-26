const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const axios = require('axios');
const Apps = require('../models/Apps');
const WecomBotConversation = require('../models/WecomBotConversation');
const { wecomBotConfig } = require('../config/wecomBot');
const { createWecomBotSecretService } = require('./wecomBotSecretService');
const appLogger = require('../utils/logger');
const { redactCredentialText } = require('../utils/credentialText');

const FASTGPT_VALIDATION_USER_ID = 'wecom_bot_config_validation';
const DEFAULT_FASTGPT_CHAT_TIMEOUT_MS = 600000;
const DEFAULT_IMAGE_URL_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const DEFAULT_FILE_URL_EXTENSIONS = ['txt', 'md', 'html', 'htm', 'doc', 'docx', 'pdf', 'ppt', 'pptx', 'csv', 'xls', 'xlsx'];
const IMAGE_URL_EXTENSIONS = new Set(DEFAULT_IMAGE_URL_EXTENSIONS);
const FILE_URL_EXTENSIONS = new Set(DEFAULT_FILE_URL_EXTENSIONS);
const FASTGPT_CHAT_ID_SIZE = 24;
const FASTGPT_CHAT_ID_FIRST_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const FASTGPT_CHAT_ID_REST_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
const FASTGPT_CHAT_ID_PATTERN = /^[a-z][a-zA-Z0-9]{23}$/;
const FASTGPT_ASSISTANT_APP_TYPE = 'assistant';
const FASTGPT_ASSISTANT_INTERNAL_VARIABLE_KEYS = new Set([
  'byG7WNk4',
  'utjZSg8f',
  'vKEVhtS6',
  'hTRJXdb1',
  'udQRlgfO'
]);
const FASTGPT_ASSISTANT_INTERNAL_VARIABLE_LABELS = new Set([
  'fallbackReply',
  'faqAnswerMode',
  'enableFallbackReply',
  'correct_mapping_answer',
  'faqAnswer'
]);

/**
 * 读取当前毫秒时间。
 * 输入: 无。
 * 输出: 当前 Unix 毫秒时间戳。
 */
function defaultNow() {
  return Date.now();
}

/**
 * 生成与 FastGPT getNanoid(24) 一致的会话 ID。
 * 输入: 可选长度，企业微信会话默认使用 24 位。
 * 输出: 首位小写字母、后续字母数字组成的无前缀字符串。
 */
function generateFastgptChatId(size = FASTGPT_CHAT_ID_SIZE) {
  const normalizedSize = Number.isInteger(size) && size > 0 ? size : FASTGPT_CHAT_ID_SIZE;
  let id = FASTGPT_CHAT_ID_FIRST_CHARS[crypto.randomInt(FASTGPT_CHAT_ID_FIRST_CHARS.length)];
  for (let index = 1; index < normalizedSize; index += 1) {
    id += FASTGPT_CHAT_ID_REST_CHARS[crypto.randomInt(FASTGPT_CHAT_ID_REST_CHARS.length)];
  }
  return id;
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
 * 归一化媒体扩展名集合。
 * 输入: 配置中的扩展名数组和默认集合。
 * 输出: 去除点号和空项后的小写扩展名 Set；配置为空时返回默认集合。
 */
function normalizeMediaExtensionSet(extensions, fallbackSet) {
  const normalized = (Array.isArray(extensions) ? extensions : [])
    .map((extension) => String(extension || '').trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);

  return normalized.length ? new Set(normalized) : new Set(fallbackSet);
}

/**
 * 解析 FastGPT 回复链接媒体扩展名配置。
 * 输入: 企业微信 Bot 配置对象。
 * 输出: 图片和文件 URL 扩展名 Set。
 */
function resolveMediaUrlExtensionSets(config = {}) {
  const mediaConfig = config?.media || {};
  return {
    imageExtensions: normalizeMediaExtensionSet(mediaConfig.allowedImageExtensions, IMAGE_URL_EXTENSIONS),
    fileExtensions: normalizeMediaExtensionSet(mediaConfig.allowedFileExtensions, FILE_URL_EXTENSIONS)
  };
}

/**
 * FastGPT Bot 适配器错误。
 * 输入: 业务错误码、错误消息和可选状态码/底层原因。
 * 输出: 带 code/statusCode/cause 的 Error 实例。
 */
class FastgptBotAdapterError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'FastgptBotAdapterError';
    this.code = code;
    this.statusCode = options.statusCode || 400;
    this.cause = options.cause;
  }
}

/**
 * 规范化 FastGPT API 基础地址。
 * 输入: 配置中的 baseUrl 字符串。
 * 输出: 去除尾部斜杠后的地址；空值返回空字符串。
 */
function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

/**
 * 判断 FastGPT 应用是否明确不可调用。
 * 输入: Apps 集合中的应用记录。
 * 输出: 应用处于草稿、未发布或显式不可用时返回 true。
 */
function isExplicitlyUnavailable(app) {
  return app?.isPublished === false || app?.published === false || app?.status === 'draft' || app?.status === 'unpublished';
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
 * 将任意 ID 转为字符串。
 * 输入: ObjectId、字符串或空值。
 * 输出: 可用于 API 请求和会话查询的字符串。
 */
function toIdString(value) {
  if (value && typeof value.toString === 'function') {
    return value.toString();
  }

  return String(value || '');
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
 * 计算消息数组中的文本长度。
 * 输入: OpenAI 兼容 messages 数组。
 * 输出: content 字段字符串长度总和。
 */
function getMessagesTextLength(messages = []) {
  if (!Array.isArray(messages)) {
    return 0;
  }

  return messages.reduce((sum, message) => {
    if (Array.isArray(message?.content)) {
      return sum + message.content
        .filter((part) => part?.type === 'text')
        .reduce((partSum, part) => partSum + String(part.text || '').length, 0);
    }

    return sum + String(message?.content || '').length;
  }, 0);
}

/**
 * 生成短哈希指纹。
 * 输入: 任意字符串。
 * 输出: 12 位十六进制哈希；空值返回空字符串。
 */
function createShortFingerprint(value) {
  const raw = toIdString(value);
  if (!raw) {
    return '';
  }

  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

/**
 * 生成 ID 的安全诊断字段。
 * 输入: 字段前缀和任意 ID。
 * 输出: 包含存在性、长度、后 6 位和哈希的对象。
 */
function buildIdDiagnostics(prefix, value) {
  const raw = toIdString(value);
  return {
    [`${prefix}Present`]: Boolean(raw),
    [`${prefix}Length`]: raw.length,
    [`${prefix}Suffix`]: raw ? raw.slice(-6) : '',
    [`${prefix}Fingerprint`]: createShortFingerprint(raw)
  };
}

/**
 * 生成安全的媒体 URL 诊断信息。
 * 输入: 媒体类型和完整 URL。
 * 输出: 不含路径和查询参数的协议、域名、长度、扩展名和短指纹。
 */
function buildMediaUrlDiagnostics(type, url) {
  const raw = toIdString(url);
  const base = {
    type,
    url: raw,
    urlPresent: Boolean(raw),
    urlLength: raw.length,
    urlExtension: getExtension(raw),
    urlFingerprint: createShortFingerprint(raw)
  };

  try {
    const parsed = new URL(raw);
    return {
      ...base,
      urlValid: true,
      urlProtocol: parsed.protocol,
      urlHost: parsed.host.toLowerCase()
    };
  } catch (error) {
    return {
      ...base,
      urlValid: false,
      urlProtocol: '',
      urlHost: ''
    };
  }
}

/**
 * 汇总 FastGPT 请求消息中的多模态内容诊断信息。
 * 输入: OpenAI 兼容 messages 数组。
 * 输出: 文本/媒体 part 数量和已脱敏的媒体 URL 摘要。
 */
function buildMessageContentDiagnostics(messages = []) {
  if (!Array.isArray(messages)) {
    return {
      contentMode: 'unknown',
      contentPartCount: 0,
      mediaPartCount: 0,
      imageUrlCount: 0,
      fileUrlCount: 0,
      mediaUrlDiagnostics: []
    };
  }

  const parts = messages.flatMap((message) => (
    Array.isArray(message?.content) ? message.content : []
  ));
  const imageParts = parts.filter((part) => part?.type === 'image_url');
  const fileParts = parts.filter((part) => part?.type === 'file_url');
  const mediaUrlDiagnostics = [
    ...imageParts.map((part) => buildMediaUrlDiagnostics('image', part.image_url?.url || part.url)),
    ...fileParts.map((part) => buildMediaUrlDiagnostics('file', part.file_url?.url || part.url))
  ];

  return {
    contentMode: parts.length ? 'multimodal' : 'text',
    contentPartCount: parts.length,
    mediaPartCount: imageParts.length + fileParts.length,
    imageUrlCount: imageParts.length,
    fileUrlCount: fileParts.length,
    mediaUrlDiagnostics
  };
}

/**
 * 从 FastGPT 响应中寻找会话 ID 来源。
 * 输入: FastGPT 原始响应数据。
 * 输出: source 和 value；缺失时 source 为 empty。
 */
function getConversationIdCandidate(responseData = {}) {
  const candidates = [
    ['chatId', responseData.chatId],
    ['conversationId', responseData.conversationId],
    ['id', responseData.id],
    ['data.chatId', responseData.data?.chatId],
    ['data.conversationId', responseData.data?.conversationId]
  ];
  const found = candidates.find(([, value]) => toIdString(value));

  return {
    source: found?.[0] || 'empty',
    value: toIdString(found?.[1])
  };
}

/**
 * 生成 FastGPT 请求的安全日志元数据。
 * 输入: API 根路径、请求体和请求超时时间。
 * 输出: 不包含 API Key 或正文内容的日志对象。
 */
function buildFastgptRequestLogMeta({ baseUrl, apiKey, body = {}, timeoutMs }) {
  const variableKeys = body.variables && typeof body.variables === 'object'
    ? Object.keys(body.variables)
    : [];
  return {
    baseUrl,
    appId: toIdString(body.appId),
    ...buildIdDiagnostics('chatId', body.chatId),
    customUidPresent: Boolean(body.customUid || body.customID),
    apiKeyFingerprint: createShortFingerprint(apiKey),
    variableCount: variableKeys.length,
    variableKeys: variableKeys.map((key) => String(key).slice(0, 80)),
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    requestTextLength: getMessagesTextLength(body.messages),
    ...buildMessageContentDiagnostics(body.messages),
    timeoutMs
  };
}

/**
 * 提取底层错误的安全摘要。
 * 输入: 任意错误对象。
 * 输出: 不包含凭证和原始 payload 的短错误元数据。
 */
function summarizeSafeError(error) {
  return {
    code: error?.code || '',
    status: error?.response?.status || error?.status || '',
    message: redactCredentialText(error?.message || error || 'error')
      .replace(/raw payload/gi, 'payload')
      .slice(0, 300)
  };
}

/**
 * 判断 FastGPT 响应片段是否为工具消息。
 * 输入: responseData 数组中的单个片段。
 * 输出: true 表示默认不应展示给企业微信。
 */
function isToolMessage(part = {}) {
  const type = String(part.type || part.moduleType || part.obj || '').toLowerCase();
  return type.includes('tool') || type.includes('plugin');
}

/**
 * 判断 FastGPT 响应片段是否为思考过程。
 * 输入: responseData 数组中的单个片段。
 * 输出: true 表示默认不应展示给企业微信。
 */
function isReasoningMessage(part = {}) {
  const type = String(part.type || part.moduleType || part.obj || '').toLowerCase();
  return type.includes('reason') || type.includes('thinking');
}

/**
 * 从 FastGPT 响应片段中提取文本。
 * 输入: responseData 片段或 OpenAI 兼容消息片段。
 * 输出: 可展示文本；没有文本时返回空字符串。
 */
function getPartText(part = {}) {
  if (typeof part === 'string') {
    return part;
  }

  if (typeof part.content === 'object' && part.content !== null) {
    return '';
  }

  return String(
    part.content ||
    part.text ||
    part.answer ||
    part.message?.content ||
    ''
  ).trim();
}

/**
 * 提取 URL 文件扩展名。
 * 输入: URL 或文件名。
 * 输出: 不带点的小写扩展名。
 */
function getExtension(value = '') {
  const pathname = (() => {
    try {
      return new URL(String(value)).pathname;
    } catch (error) {
      return String(value || '');
    }
  })();
  const match = pathname.toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
  return match ? match[1] : '';
}

/**
 * 判断 URL 是否为图片。
 * 输入: URL 字符串和可选媒体扩展名配置。
 * 输出: 扩展名属于图片类型时返回 true。
 */
function isImageUrl(url, mediaExtensions = resolveMediaUrlExtensionSets()) {
  return mediaExtensions.imageExtensions.has(getExtension(url));
}

/**
 * 判断 URL 是否为文件。
 * 输入: URL 字符串和可选媒体扩展名配置。
 * 输出: 扩展名属于文档文件类型时返回 true。
 */
function isFileUrl(url, mediaExtensions = resolveMediaUrlExtensionSets()) {
  return mediaExtensions.fileExtensions.has(getExtension(url));
}

/**
 * 判断 URL 协议是否可发送。
 * 输入: URL 字符串。
 * 输出: HTTP(S) URL 返回 true。
 */
function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

/**
 * 从 URL 中生成默认文件名。
 * 输入: URL 和兜底名称。
 * 输出: URL 末段文件名或兜底值。
 */
function getNameFromUrl(url, fallback = '') {
  try {
    const parsed = new URL(String(url || ''));
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    return name || fallback;
  } catch (error) {
    return fallback;
  }
}

/**
 * 归一化待发送给 FastGPT 的媒体数组。
 * 输入: 显式 media 数组或兼容旧调用的 image_url/file_url。
 * 输出: { type, url, name } 数组。
 */
function normalizeMediaItems({ media = [], image_url: imageUrl, file_url: fileUrl } = {}) {
  const items = Array.isArray(media) ? media : [];
  const normalized = items
    .map((item) => ({
      type: String(item.type || item.kind || item.mediaKind || '').toLowerCase(),
      url: item.url || item.ossUrl || item.image_url || item.file_url,
      name: item.name || item.originalName || item.filename || ''
    }))
    .filter((item) => item.type && item.url);

  if (imageUrl) {
    normalized.push({ type: 'image', url: imageUrl, name: getNameFromUrl(imageUrl, 'image') });
  }
  if (fileUrl) {
    normalized.push({ type: 'file', url: fileUrl, name: getNameFromUrl(fileUrl, 'file') });
  }

  const seen = new Set();
  return normalized.filter((item) => {
    const key = `${item.type}:${toIdString(item.url)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * 构建 FastGPT OpenAI 兼容 content。
 * 输入: 文本和媒体数组。
 * 输出: 纯文本时返回字符串；有媒体时返回多模态 content 数组。
 */
function buildFastgptMessageContent({ text = '', media = [] } = {}) {
  const normalizedMedia = normalizeMediaItems({ media });
  const trimmedText = String(text || '').trim();
  if (!normalizedMedia.length) {
    return trimmedText;
  }

  const content = [{
    type: 'text',
    text: trimmedText
  }];

  normalizedMedia.forEach((item) => {
    if (item.type === 'image') {
      content.push({
        type: 'image_url',
        image_url: { url: item.url }
      });
      return;
    }

    if (item.type === 'file') {
      content.push({
        type: 'file_url',
        name: item.name || getNameFromUrl(item.url, 'file'),
        url: item.url
      });
    }
  });

  return content;
}

/**
 * 从结构化对象中提取媒体回复块。
 * 输入: FastGPT 回复对象和可选媒体扩展名配置。
 * 输出: 可发送给企业微信的媒体块或 null。
 */
function extractStructuredMediaBlock(part = {}, mediaExtensions = resolveMediaUrlExtensionSets()) {
  const type = String(part.type || part.kind || part.mediaKind || '').toLowerCase();
  const url = part.url || part.href || part.imageUrl || part.fileUrl || part.image_url?.url || part.file_url?.url;
  if (!url || !isSafeHttpUrl(url)) {
    return null;
  }

  if (type.includes('image') || isImageUrl(url, mediaExtensions)) {
    return {
      type: 'image',
      url,
      alt: part.alt || part.name || part.title || getNameFromUrl(url, 'image')
    };
  }

  if (type.includes('file') || isFileUrl(url, mediaExtensions)) {
    return {
      type: 'file',
      url,
      name: part.name || part.filename || getNameFromUrl(url, 'file')
    };
  }

  return null;
}

/**
 * 给回复块附加不可枚举的来源诊断。
 * 输入: 标准 replyBlock 和来源路径。
 * 输出: 仍可被旧断言视为普通 replyBlock 的对象。
 */
function markReplyBlockSource(block, sourcePath = '') {
  if (!block || typeof block !== 'object' || !sourcePath) {
    return block;
  }

  const nextBlock = { ...block };
  Object.defineProperty(nextBlock, 'sourcePath', {
    value: sourcePath,
    enumerable: false,
    configurable: true
  });
  return nextBlock;
}

/**
 * 为一组回复块附加来源诊断。
 * 输入: replyBlocks 数组和来源路径。
 * 输出: 附加不可枚举来源后的 replyBlocks。
 */
function markReplyBlocksSource(blocks = [], sourcePath = '') {
  return blocks.map((block) => markReplyBlockSource(block, sourcePath));
}

/**
 * 判断 detail 结构化媒体是否明确属于最终可见回答。
 * 输入: responseData 中的结构化片段。
 * 输出: 显式 final/assistant final/output 标记命中时返回 true。
 */
function isFinalVisibleMediaPart(part = {}) {
  if (!part || typeof part !== 'object') {
    return false;
  }

  const role = String(part.role || part.message?.role || '').toLowerCase();
  const visibility = String(part.visibility || part.visibleTo || part.scope || '').toLowerCase();
  const phase = String(part.phase || part.stage || part.status || '').toLowerCase();
  const type = String(part.type || part.kind || part.mediaKind || '').toLowerCase();
  const hasFinalFlag = part.final === true ||
    part.isFinal === true ||
    part.finalOutput === true ||
    part.isFinalOutput === true ||
    part.visible === true ||
    part.isVisible === true;
  const hasAssistantFinalMarker = role === 'assistant' &&
    (hasFinalFlag || visibility === 'final' || visibility === 'answer' || phase === 'final');
  const hasAnswerFinalMarker = type.includes('answer') && hasFinalFlag;

  return hasAssistantFinalMarker || hasAnswerFinalMarker;
}

/**
 * 判断 detail 片段是否为明确最终可见文本。
 * 输入: responseData 中的结构化片段。
 * 输出: answer/final 或 assistant final 文本片段返回 true，工具与推理片段返回 false。
 */
function isFinalVisibleTextPart(part = {}) {
  if (!part || typeof part !== 'object' || isToolMessage(part) || isReasoningMessage(part)) {
    return false;
  }

  const type = String(part.type || part.kind || part.mediaKind || '').toLowerCase();
  return type.includes('answer') || type.includes('final') || isFinalVisibleMediaPart(part);
}

/**
 * 提取顶层最终媒体回复块。
 * 输入: FastGPT 顶层响应对象和可选媒体扩展名配置。
 * 输出: 顶层 image_url/file_url 对应的可见媒体块。
 */
function extractTopLevelFinalMediaBlocks(responseData = {}, mediaExtensions = resolveMediaUrlExtensionSets()) {
  const candidates = [];
  const imageUrl = typeof responseData.image_url === 'string'
    ? responseData.image_url
    : responseData.image_url?.url;
  if (imageUrl) {
    candidates.push({
      type: 'image',
      image_url: { url: imageUrl },
      alt: responseData.image_url?.alt || responseData.image_url?.name
    });
  }

  const fileUrl = typeof responseData.file_url === 'string'
    ? responseData.file_url
    : responseData.file_url?.url;
  if (fileUrl) {
    candidates.push({
      type: 'file',
      file_url: { url: fileUrl },
      name: responseData.file_url?.name || responseData.file_url?.filename
    });
  }

  return markReplyBlocksSource(
    candidates
      .map((candidate) => extractStructuredMediaBlock(candidate, mediaExtensions))
      .filter(Boolean),
    'topLevel'
  );
}

/**
 * 统计 replyBlocks 的来源路径。
 * 输入: 标准 replyBlocks 数组。
 * 输出: 可写入安全日志的来源计数。
 */
function buildReplyBlockSourceStats(blocks = []) {
  return (Array.isArray(blocks) ? blocks : []).reduce((stats, block) => {
    const sourcePath = block?.sourcePath || 'unknown';
    stats[sourcePath] = (stats[sourcePath] || 0) + 1;
    return stats;
  }, {});
}

/**
 * 清理文本中 URL 末尾的句读符号。
 * 输入: 从文本中匹配到的 URL 候选值。
 * 输出: 去掉句尾标点后的 URL。
 */
function trimTextUrlCandidate(value = '') {
  return String(value || '').replace(/[).,，。!！?？;；:：\]}]+$/u, '');
}

/**
 * 根据 URL 构造媒体回复块。
 * 输入: URL、可选标签、强制媒体类型和可选媒体扩展名配置。
 * 输出: image/file 回复块；非媒体 URL 返回 null。
 */
function buildMediaBlockFromUrl(url, { label = '', forceType = '' } = {}, mediaExtensions = resolveMediaUrlExtensionSets()) {
  const normalizedUrl = trimTextUrlCandidate(url);
  if (!normalizedUrl || !isSafeHttpUrl(normalizedUrl)) {
    return null;
  }

  const normalizedForceType = String(forceType || '').toLowerCase();
  if (normalizedForceType === 'image' || isImageUrl(normalizedUrl, mediaExtensions)) {
    return {
      type: 'image',
      url: normalizedUrl,
      alt: String(label || '').trim() || getNameFromUrl(normalizedUrl, 'image')
    };
  }

  if (normalizedForceType === 'file' || isFileUrl(normalizedUrl, mediaExtensions)) {
    return {
      type: 'file',
      url: normalizedUrl,
      name: getNameFromUrl(normalizedUrl, String(label || '').trim() || 'file')
    };
  }

  return null;
}

/**
 * 判断文本区间是否落在已有匹配内。
 * 输入: 起止位置和已匹配区间。
 * 输出: 存在重叠时返回 true。
 */
function overlapsMatchedRange(start, end, ranges = []) {
  return ranges.some((range) => start < range.end && end > range.start);
}

/**
 * 从单行文本中匹配媒体链接。
 * 输入: 单行 FastGPT 文本和可选媒体扩展名配置。
 * 输出: 带位置的媒体块匹配结果。
 */
function extractMediaMatchesFromLine(line = '', mediaExtensions = resolveMediaUrlExtensionSets()) {
  const matches = [];
  const matchedRanges = [];
  const markdownPattern = /(!?)\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g;
  let markdownMatch = markdownPattern.exec(line);
  while (markdownMatch) {
    const [raw, imageMarker, label, url] = markdownMatch;
    const block = buildMediaBlockFromUrl(url, {
      label,
      forceType: imageMarker ? 'image' : ''
    }, mediaExtensions);
    if (block) {
      const start = markdownMatch.index;
      const end = start + raw.length;
      matches.push({ start, end, block });
      matchedRanges.push({ start, end });
    }
    markdownMatch = markdownPattern.exec(line);
  }

  const bareUrlPattern = /https?:\/\/[^\s<>"`]+/g;
  let bareMatch = bareUrlPattern.exec(line);
  while (bareMatch) {
    const raw = bareMatch[0];
    const start = bareMatch.index;
    const end = start + raw.length;
    if (!overlapsMatchedRange(start, end, matchedRanges)) {
      const block = buildMediaBlockFromUrl(raw, {}, mediaExtensions);
      if (block) {
        matches.push({ start, end, block });
      }
    }
    bareMatch = bareUrlPattern.exec(line);
  }

  return matches.sort((left, right) => left.start - right.start);
}

/**
 * 标准化从媒体链接之间截取出的可见文本。
 * 输入: 原始文本片段。
 * 输出: 去除多余空白后的文本。
 */
function normalizeVisibleTextFragment(text = '') {
  return String(text || '').replace(/[ \t]+/g, ' ').trim();
}

/**
 * 从文本中提取可回复块。
 * 输入: FastGPT 文本内容和可选媒体扩展名配置。
 * 输出: 文本、图片和文件回复块数组。
 */
function extractBlocksFromText(text = '', mediaExtensions = resolveMediaUrlExtensionSets()) {
  const blocks = [];
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((line) => {
    const mediaMatches = extractMediaMatchesFromLine(line, mediaExtensions);
    if (!mediaMatches.length) {
      const visibleText = normalizeVisibleTextFragment(line);
      if (visibleText) {
        blocks.push({
          type: 'text',
          text: visibleText
        });
      }
      return;
    }

    let cursor = 0;
    mediaMatches.forEach((match) => {
      const visibleText = normalizeVisibleTextFragment(line.slice(cursor, match.start));
      if (visibleText) {
        blocks.push({
          type: 'text',
          text: visibleText
        });
      }
      blocks.push(match.block);
      cursor = match.end;
    });

    const tailText = normalizeVisibleTextFragment(line.slice(cursor));
    if (tailText) {
      blocks.push({
        type: 'text',
        text: tailText
      });
    }
  });

  return blocks;
}

/**
 * 从任意 FastGPT 内容片段中提取回复块。
 * 输入: 字符串、数组或结构化对象，以及可选媒体扩展名配置。
 * 输出: 统一回复块数组。
 */
function extractBlocksFromContent(content, mediaExtensions = resolveMediaUrlExtensionSets()) {
  const formBlocks = extractFormBlocksFromPayload(content);
  if (formBlocks.length) {
    return markReplyBlocksSource(formBlocks, 'formControl');
  }

  if (typeof content === 'string') {
    return markReplyBlocksSource(extractBlocksFromText(content, mediaExtensions), 'answer');
  }

  if (Array.isArray(content)) {
    return content.flatMap((item) => extractBlocksFromContent(item, mediaExtensions));
  }

  if (!content || typeof content !== 'object') {
    return [];
  }

  const mediaUrl = content.url ||
    content.href ||
    content.imageUrl ||
    content.fileUrl ||
    content.image_url?.url ||
    content.file_url?.url;
  if (mediaUrl && isSafeHttpUrl(mediaUrl)) {
    const mediaBlock = extractStructuredMediaBlock(content, mediaExtensions);
    return mediaBlock
      ? [markReplyBlockSource(mediaBlock, 'answer')]
      : [markReplyBlockSource({ type: 'text', text: String(mediaUrl).trim() }, 'answer')];
  }

  if (typeof content.text === 'string' || typeof content.answer === 'string') {
    return markReplyBlocksSource(extractBlocksFromText(content.text || content.answer, mediaExtensions), 'answer');
  }

  return [];
}

/**
 * 从内容节点保留原始可见 Markdown。
 * 输入: 字符串、数组或结构化对象。
 * 输出: 不折叠内部格式的文本数组。
 */
function extractVisibleMarkdownParts(content) {
  if (typeof content === 'string') {
    return [content];
  }

  if (Array.isArray(content)) {
    return content.flatMap((item) => extractVisibleMarkdownParts(item));
  }

  if (!content || typeof content !== 'object') {
    return [];
  }

  if (content.url || content.href || content.image_url || content.file_url || content.imageUrl || content.fileUrl) {
    return [];
  }

  const value = typeof content.content === 'string'
    ? content.content
    : (typeof content.text === 'string'
      ? content.text
      : (typeof content.answer === 'string' ? content.answer : ''));
  return value ? [value] : [];
}

/**
 * 按来源内原顺序拼接 Markdown 片段。
 * 输入: 同一 FastGPT 来源中的可见文本数组。
 * 输出: 保留内部重复、换行和边界空白的 Markdown。
 */
function joinMarkdownParts(parts = []) {
  return parts
    .map((part) => String(part ?? ''))
    .filter((part) => part !== '')
    .reduce((markdown, part, index) => {
      if (index === 0) {
        return part;
      }
      const hasBoundaryNewline = markdown.endsWith('\n') || markdown.endsWith('\r') ||
        part.startsWith('\n') || part.startsWith('\r');
      return `${markdown}${hasBoundaryNewline ? '' : '\n'}${part}`;
    }, '');
}

/**
 * 合成流式与非流式共享的最终文档。
 * 输入: 按优先级排列的主答案来源和按遇到顺序排列的调试补充来源。
 * 输出: 主答案在前、已脱敏补充在后的确定性 Markdown。
 */
function composeFinalReplyMarkdown({ primarySources = [], supplementalSources = [] } = {}) {
  // 作用: 仅在完整来源文档层面去除跨字段别名；输入为来源片段数组；输出为保留来源内重复的文档数组。
  const composeSources = (sources, { sanitize = false, deduplicate = true } = {}) => {
    const seenSourceDocuments = new Set();
    return sources
      .map((parts) => (Array.isArray(parts) ? parts : [parts]))
      .map((parts) => parts.map((part) => (
        sanitize ? sanitizeVisibleText(part) : String(part ?? '')
      )))
      .map((parts) => joinMarkdownParts(parts))
      .filter((markdown) => {
        if (!markdown) return false;
        if (!deduplicate) return true;
        if (seenSourceDocuments.has(markdown)) return false;
        seenSourceDocuments.add(markdown);
        return true;
      });
  };

  const primaryDocuments = composeSources(primarySources);
  const supplementalDocuments = composeSources(supplementalSources, {
    sanitize: true,
    deduplicate: false
  });
  return joinMarkdownParts([...primaryDocuments, ...supplementalDocuments]);
}

/**
 * 去除后续 SSE 来源对既有调试片段的精确重传。
 * 输入: 按 SSE 到达顺序排列的 Markdown 片段来源。
 * 输出: 来源内重复保留、仅删除与早先来源相同片段的来源数组。
 */
function deduplicateMarkdownPartsAcrossSources(sources = []) {
  const seenPreviousSourceParts = new Set();
  return sources
    .map((source) => (Array.isArray(source) ? source : [source])
      .map((part) => String(part ?? '')))
    .map((sourceParts) => {
      const uniqueParts = sourceParts.filter((part) => (
        part !== '' && !seenPreviousSourceParts.has(part)
      ));
      sourceParts.forEach((part) => {
        if (part !== '') seenPreviousSourceParts.add(part);
      });
      return uniqueParts;
    })
    .filter((sourceParts) => sourceParts.length);
}

/**
 * 归一化结构化最终媒体。
 * 输入: 媒体回复块及来源路径。
 * 输出: replyDocument 媒体条目。
 */
function toReplyDocumentMedia(block = {}, sourcePath = '') {
  return {
    type: block.type,
    url: String(block.url || '').trim(),
    alt: String(block.alt || '').trim(),
    name: String(block.name || '').trim(),
    sourcePath
  };
}

/**
 * 按媒体类型和 URL 去重回复文档媒体。
 * 输入: 按来源优先级排列的结构化媒体数组。
 * 输出: 保留每个 type:url 首次出现项的媒体数组。
 */
function deduplicateReplyDocumentMedia(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type}:${item.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * 从数组内容中递归提取无正文位置的结构化媒体。
 * 输入: 内容节点、媒体扩展名配置和来源路径。
 * 输出: replyDocument 媒体数组。
 */
function extractStructuredReplyMedia(content, mediaExtensions, sourcePath = 'choiceContent') {
  if (Array.isArray(content)) {
    return content.flatMap((item) => extractStructuredReplyMedia(item, mediaExtensions, sourcePath));
  }

  if (!content || typeof content !== 'object') {
    return [];
  }

  const block = extractStructuredMediaBlock(content, mediaExtensions);
  return block ? [toReplyDocumentMedia(block, sourcePath)] : [];
}

/**
 * 提取流式 responseData 中允许展示的补充调试正文。
 * 输入: FastGPT SSE 载荷和工具/推理展示策略。
 * 输出: 按 payload 内原始顺序排列的 tool/reasoning Markdown 来源数组。
 */
function extractSupplementalReplyMarkdownSources(
  responseData = {},
  { showToolMessages = false, showReasoning = false } = {}
) {
  if (!Array.isArray(responseData.responseData)) {
    return [];
  }

  const parts = responseData.responseData.flatMap((part) => {
    const isVisibleTool = showToolMessages && isToolMessage(part);
    const isVisibleReasoning = showReasoning && isReasoningMessage(part);
    return isVisibleTool || isVisibleReasoning ? extractVisibleMarkdownParts(part) : [];
  });
  return parts.length ? [parts] : [];
}

/**
 * 提取明确最终 Markdown 来源。
 * 输入: FastGPT 完整响应或单个 SSE 载荷，以及是否允许把单独顶层 answer 当作终稿。
 * 输出: choices.message.content、answer/final detail 和顶层 answer/final 的保序来源数组，不含兼容 text 增量。
 */
function extractExplicitFinalReplyMarkdownSources(responseData = {}, {
  allowStandaloneTopLevelAnswer = true
} = {}) {
  const sources = [];
  const choiceParts = extractVisibleMarkdownParts(responseData.choices?.[0]?.message?.content);
  if (choiceParts.length) {
    sources.push(choiceParts);
  }

  const detailParts = Array.isArray(responseData.responseData)
    ? responseData.responseData
      .filter((part) => isFinalVisibleTextPart(part))
      .flatMap((part) => extractVisibleMarkdownParts(part))
    : [];
  if (detailParts.length) {
    sources.push(detailParts);
  }

  [responseData.final, responseData.data?.final].forEach((value) => {
    const parts = extractVisibleMarkdownParts(value);
    if (parts.length) {
      sources.push(parts);
    }
  });

  const hasStrongFinalSource = sources.length > 0;
  const hasSamePayloadDraftText = typeof responseData.text === 'string' && responseData.text !== '';
  if (allowStandaloneTopLevelAnswer || hasStrongFinalSource || hasSamePayloadDraftText) {
    [responseData.answer, responseData.data?.answer].forEach((value) => {
      const parts = extractVisibleMarkdownParts(value);
      if (parts.length) {
        sources.push(parts);
      }
    });
  }
  return sources;
}

/**
 * 从 FastGPT 响应中解析会话 ID。
 * 输入: FastGPT 原始响应数据。
 * 输出: 会话 ID 字符串；缺失时返回空字符串。
 */
function extractConversationId(responseData = {}) {
  return getConversationIdCandidate(responseData).value;
}

/**
 * 净化可展示的调试文本。
 * 输入: FastGPT 工具、推理或错误事件中的原始文本。
 * 输出: 脱敏后的文本，避免泄露 key、secret、token、Bearer 和 raw payload。
 */
function sanitizeVisibleText(text = '') {
  return redactCredentialText(text)
    .replace(/raw payload/gi, 'payload');
}

/**
 * 净化回复块中的文本内容。
 * 输入: 标准 replyBlocks 数组。
 * 输出: 文本块脱敏后的 replyBlocks 数组。
 */
function sanitizeReplyBlocks(blocks = []) {
  return blocks.map((block) => {
    if (block?.type !== 'text') {
      return block;
    }

    return {
      ...block,
      text: sanitizeVisibleText(block.text)
    };
  });
}

/**
 * 判断字段是否带有有效值。
 * 输入: 任意字段值。
 * 输出: 非 null/undefined/空字符串时返回 true。
 */
function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * 归一化 FastGPT 变量类型。
 * 输入: FastGPT 变量原始类型。
 * 输出: Worker 支持的 text/number/select/multiSelect 类型；不可识别时返回空字符串。
 */
function normalizeVariableType(variable = {}) {
  const rawType = String(
    variable.type ||
    variable.valueType ||
    variable.inputType ||
    variable.component ||
    ''
  ).toLowerCase();
  const rawValueType = String(variable.valueType || variable.value_type || variable.dataType || '').toLowerCase();
  const renderTypes = Array.isArray(variable.renderTypeList)
    ? variable.renderTypeList.map((item) => String(item || '').toLowerCase())
    : [];
  const typeCandidates = [rawType, rawValueType, ...renderTypes].filter(Boolean);
  const hasOptions = Array.isArray(variable.list) || Array.isArray(variable.enums) || Array.isArray(variable.options);

  if (!rawType && hasOptions) {
    return 'select';
  }

  if (typeCandidates.some((type) => ['multipleselect', 'multiselect', 'selectmulti', 'multi-select', 'checkbox'].includes(type)) ||
    (hasOptions && typeCandidates.some((type) => ['array', 'arraystring', 'arraynumber', 'arrayboolean', 'arrayobject', 'arrayany'].includes(type)))) {
    return 'multiSelect';
  }

  if (typeCandidates.some((type) => ['select', 'list', 'enum', 'enums', 'radio'].includes(type))) {
    return 'select';
  }

  if (typeCandidates.some((type) => ['numberinput', 'number'].includes(type))) {
    return 'number';
  }

  if (typeCandidates.some((type) => ['text', 'string', 'textarea', 'input'].includes(type))) {
    return 'text';
  }

  return '';
}

/**
 * 归一化一个选择项。
 * 输入: FastGPT list/enums/options 中的原始选项。
 * 输出: { label, value }；无有效展示和值时返回 null。
 */
function normalizeVariableOption(option) {
  if (option === null || option === undefined) {
    return null;
  }

  if (typeof option !== 'object') {
    const value = String(option).trim();
    return value ? { label: value, value } : null;
  }

  const label = String(
    option.label ??
    option.name ??
    option.text ??
    option.title ??
    option.value ??
    option.key ??
    ''
  ).trim();
  const valueSource = option.value ?? option.key ?? option.id ?? option.name ?? option.label ?? option.text;
  const value = hasValue(valueSource) ? String(valueSource).trim() : label;
  if (!label && !value) {
    return null;
  }

  return {
    label: label || value,
    value: value || label
  };
}

/**
 * 读取有限数字约束。
 * 输入: 任意候选值。
 * 输出: 有限数字；无有效约束时返回 undefined。
 */
function normalizeNumericConstraint(value) {
  if (!hasValue(value)) {
    return undefined;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

/**
 * 读取正整数长度约束。
 * 输入: 任意候选值。
 * 输出: 正整数长度；无有效约束时返回 undefined。
 */
function normalizePositiveIntegerConstraint(value) {
  const numericValue = normalizeNumericConstraint(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }
  return Math.floor(numericValue);
}

/**
 * 读取 FastGPT 原始变量定义。
 * 输入: app.chatConfig.variables、运行时 inputForm 或字段数组。
 * 输出: 原始变量定义数组；缺失时返回空数组。
 */
function getRawFastgptVariables(variables = []) {
  return Array.isArray(variables)
    ? variables
    : (Array.isArray(variables?.chatConfig?.variables) ? variables.chatConfig.variables : []);
}

/**
 * 判断是否为新版 FastGPT 智能问答应用。
 * 输入: FastGPT 应用记录。
 * 输出: 应用类型为 assistant 时返回 true。
 */
function isFastgptAssistantApp(app = {}) {
  return String(app?.type || app?.appType || '').trim().toLowerCase() === FASTGPT_ASSISTANT_APP_TYPE;
}

/**
 * 判断变量是否为智能问答内部配置或运行时变量。
 * 输入: FastGPT chatConfig.variables 中的单个变量定义。
 * 输出: 命中固定 key 或 label 时返回 true。
 */
function isAssistantInternalVariable(variable = {}) {
  if (!variable || typeof variable !== 'object') {
    return false;
  }

  const key = String(variable.key || variable.variable || variable.name || variable.id || '').trim();
  const label = String(variable.label || variable.title || variable.name || '').trim();
  return FASTGPT_ASSISTANT_INTERNAL_VARIABLE_KEYS.has(key) ||
    FASTGPT_ASSISTANT_INTERNAL_VARIABLE_LABELS.has(label);
}

/**
 * 提取适合在企微开场阶段询问用户的应用变量。
 * 输入: FastGPT 应用记录。
 * 输出: 过滤智能问答内部配置后的变量定义数组。
 */
function getOpeningPromptVariables(app = {}) {
  const rawVariables = getRawFastgptVariables(app);
  if (!rawVariables.length || isFastgptAssistantApp(app)) {
    return [];
  }

  return rawVariables.filter((variable) => !isAssistantInternalVariable(variable));
}

/**
 * 归一化 FastGPT 表单变量定义。
 * 输入: app.chatConfig.variables、运行时 inputForm 或字段数组。
 * 输出: Worker 可消费的字段数组，跳过缺少 key 或类型不可识别的字段。
 */
function normalizeFastgptVariables(variables = []) {
  const rawVariables = getRawFastgptVariables(variables);

  return rawVariables
    .map((variable) => {
      if (!variable || typeof variable !== 'object') {
        return null;
      }

      const key = String(variable.key || variable.variable || variable.name || variable.id || '').trim();
      const type = normalizeVariableType(variable);
      if (!key || !type) {
        return null;
      }

      const label = String(variable.label || variable.title || variable.name || key).trim();
      const options = [
        ...(Array.isArray(variable.options) ? variable.options : []),
        ...(Array.isArray(variable.list) ? variable.list : []),
        ...(Array.isArray(variable.enums) ? variable.enums : [])
      ]
        .map((option) => normalizeVariableOption(option))
        .filter(Boolean);
      const defaultSource = variable.defaultValue ?? variable.default ?? variable.value;
      const field = {
        key,
        label: label || key,
        type,
        required: variable.required === true || variable.isRequired === true || variable.required === 'true',
        defaultValue: hasValue(defaultSource) ? defaultSource : undefined,
        options: ['select', 'multiSelect'].includes(type) ? options : []
      };
      const maxLength = normalizePositiveIntegerConstraint(
        variable.maxLength ?? variable.maxlength ?? variable.max_length ?? (type === 'text' ? variable.max : undefined)
      );
      if (type === 'text' && maxLength !== undefined) {
        field.maxLength = maxLength;
      }
      if (type === 'number') {
        const minValue = normalizeNumericConstraint(variable.minValue ?? variable.min ?? variable.minimum);
        const maxValue = normalizeNumericConstraint(variable.maxValue ?? variable.max ?? variable.maximum);
        if (minValue !== undefined) {
          field.minValue = minValue;
        }
        if (maxValue !== undefined) {
          field.maxValue = maxValue;
        }
      }

      if (['select', 'multiSelect'].includes(field.type) && !field.options.length) {
        return null;
      }

      return field;
    })
    .filter(Boolean);
}

/**
 * 基于变量定义生成稳定 hash。
 * 输入: 归一化前或归一化后的变量定义。
 * 输出: 16 位 sha256 指纹；无变量时返回空字符串。
 */
function createVariableSchemaHash(variables = []) {
  const fields = normalizeFastgptVariables(variables);
  if (!fields.length) {
    return '';
  }

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(fields))
    .digest('hex')
    .slice(0, 16);
}

/**
 * 判断节点是否表示 FastGPT 表单已提交。
 * 输入: 任意 FastGPT 响应节点。
 * 输出: 已提交时返回 true，否则返回 false。
 */
function hasSubmittedRuntimeFormMarker(payload, seen = new Set()) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  if (seen.has(payload)) {
    return false;
  }
  seen.add(payload);

  if (payload.submitted === true || payload.params?.submitted === true || payload.interactive?.params?.submitted === true) {
    return true;
  }
  if (payload.formInputResult !== undefined) {
    return true;
  }

  if (Array.isArray(payload)) {
    return payload.some((item) => hasSubmittedRuntimeFormMarker(item, seen));
  }

  return Object.values(payload).some((value) => hasSubmittedRuntimeFormMarker(value, seen));
}

/**
 * 从运行时表单载荷中读取字段数组。
 * 输入: FastGPT interactive.userInput、inputForm 或兼容对象。
 * 输出: 原始字段数组；缺失时返回空数组。
 */
function getRuntimeFormFields(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  return payload.variables ||
    payload.inputForm ||
    payload.params?.inputForm ||
    payload.interactive?.params?.inputForm ||
    payload.interactive?.inputForm ||
    payload.interactive?.userInput ||
    payload.userInput ||
    payload.fields ||
    payload.formFields ||
    payload.form ||
    [];
}

/**
 * 归一化运行时表单块。
 * 输入: 运行时表单载荷和来源标记。
 * 输出: form replyBlock；无字段时返回 null。
 */
function buildFormReplyBlock(payload, source = '') {
  const fields = normalizeFastgptVariables(getRuntimeFormFields(payload));
  if (!fields.length) {
    return null;
  }

  return {
    type: 'form',
    title: String(payload?.title ||
      payload?.label ||
      payload?.name ||
      payload?.description ||
      payload?.params?.description ||
      payload?.interactive?.params?.description ||
      '').trim(),
    source: source || 'runtime',
    submitted: false,
    fields
  };
}

/**
 * 读取当前节点可直接解释为表单的候选载荷。
 * 输入: FastGPT 响应节点。
 * 输出: 候选载荷数组。
 */
function getRuntimeFormCandidates(payload = {}) {
  if (Array.isArray(payload)) {
    return [payload];
  }
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  return [
    payload.interactive?.userInput,
    payload.userInput,
    payload.interactive,
    payload.interactive?.params,
    payload.interactive?.inputForm,
    payload.params,
    payload.inputForm
  ].filter(Boolean);
}

/**
 * 从 FastGPT payload 中提取表单 replyBlock。
 * 输入: 任意响应片段。
 * 输出: form replyBlock 数组。
 */
function extractFormBlocksFromPayload(payload = {}, seen = new Set()) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  if (seen.has(payload)) {
    return [];
  }
  seen.add(payload);

  if (hasSubmittedRuntimeFormMarker(payload)) {
    return [];
  }

  const blocks = [];
  for (const candidate of getRuntimeFormCandidates(payload)) {
    const block = buildFormReplyBlock(candidate, 'runtime');
    if (block) {
      blocks.push(block);
      break;
    }
  }

  if (blocks.length) {
    return blocks;
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((item) => extractFormBlocksFromPayload(item, seen));
  }

  return Object.entries(payload)
    .filter(([key]) => !['inputForm', 'userInput', 'form', 'formFields', 'fields'].includes(key))
    .flatMap(([, value]) => extractFormBlocksFromPayload(value, seen));
}

/**
 * 构建 FastGPT variables 请求体片段。
 * 输入: 已收集变量值对象。
 * 输出: 有变量时返回 { variables }，否则返回空对象。
 */
function buildVariablesBody(variables = {}) {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return {};
  }

  const entries = Object.entries(variables)
    .filter(([key, value]) => String(key || '').trim() && hasValue(value));
  if (!entries.length) {
    return {};
  }

  return {
    variables: Object.fromEntries(entries)
  };
}

/**
 * 将 FastGPT 流式响应转成文本片段。
 * 输入: Node Readable、async iterable、字符串或 Buffer。
 * 输出: 可供 SSE 解析器消费的异步文本片段。
 */
async function* readStreamTextChunks(source) {
  if (source == null) {
    return;
  }

  if (typeof source === 'string') {
    yield source;
    return;
  }

  if (Buffer.isBuffer(source)) {
    const decoder = new StringDecoder('utf8');
    yield decoder.end(source);
    return;
  }

  if (typeof source[Symbol.asyncIterator] === 'function') {
    let decoder = new StringDecoder('utf8');
    for await (const chunk of source) {
      if (Buffer.isBuffer(chunk)) {
        const text = decoder.write(chunk);
        if (text) {
          yield text;
        }
        continue;
      }

      const pendingText = decoder.end();
      if (pendingText) {
        yield pendingText;
      }
      decoder = new StringDecoder('utf8');
      const text = String(chunk || '');
      if (text) {
        yield text;
      }
    }

    const tailText = decoder.end();
    if (tailText) {
      yield tailText;
    }
    return;
  }

  if (typeof source[Symbol.iterator] === 'function') {
    let decoder = new StringDecoder('utf8');
    for (const chunk of source) {
      if (Buffer.isBuffer(chunk)) {
        const text = decoder.write(chunk);
        if (text) {
          yield text;
        }
        continue;
      }

      const pendingText = decoder.end();
      if (pendingText) {
        yield pendingText;
      }
      decoder = new StringDecoder('utf8');
      const text = String(chunk || '');
      if (text) {
        yield text;
      }
    }

    const tailText = decoder.end();
    if (tailText) {
      yield tailText;
    }
    return;
  }

  yield String(source || '');
}

/**
 * 解析 Server-Sent Events 数据块。
 * 输入: 文本片段异步迭代器。
 * 输出: { event, data } 形式的 SSE 事件，不暴露原始 data 行。
 */
async function* parseSseEvents(source) {
  let buffer = '';

  for await (const chunk of readStreamTextChunks(source)) {
    buffer += chunk;
    buffer = buffer.replace(/\r\n/g, '\n');

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex >= 0) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const event = parseSseEventBlock(rawEvent);
      if (event) {
        yield event;
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const event = parseSseEventBlock(tail);
    if (event) {
      yield event;
    }
  }
}

/**
 * 解析单个 SSE 事件块。
 * 输入: 已按空行切分的 SSE 文本块。
 * 输出: { event, data }；空块返回 null。
 */
function parseSseEventBlock(rawEvent = '') {
  const lines = String(rawEvent || '').split('\n');
  const dataLines = [];
  let eventName = 'message';

  lines.forEach((line) => {
    if (!line || line.startsWith(':')) {
      return;
    }

    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim() || 'message';
      return;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  });

  if (!dataLines.length) {
    return null;
  }

  return {
    event: eventName,
    data: dataLines.join('\n')
  };
}

/**
 * 解析 SSE data JSON。
 * 输入: SSE data 字符串。
 * 输出: JSON 对象；[DONE] 返回 done 标记。
 */
function parseSsePayload(data = '') {
  const trimmed = String(data || '').trim();
  if (trimmed === '[DONE]') {
    return { done: true };
  }

  return {
    done: false,
    payload: JSON.parse(trimmed)
  };
}

/**
 * 提取流式事件中的文本增量。
 * 输入: SSE 事件名和 JSON payload。
 * 输出: 带分类的文本增量数组，用于后续可见性过滤。
 */
function extractStreamTextDeltas(eventName = 'message', payload = {}) {
  const deltas = [];
  const choices = Array.isArray(payload.choices) ? payload.choices : [];

  choices.forEach((choice) => {
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') {
      deltas.push({ text: delta.content, kind: 'answer' });
    }
    const reasoningText = delta.reasoning_content || delta.reasoning || delta.thinking;
    if (typeof reasoningText === 'string') {
      deltas.push({ text: reasoningText, kind: 'reasoning' });
    }
    if (typeof choice.text === 'string') {
      deltas.push({ text: choice.text, kind: 'answer' });
    }
  });

  const streamPart = {
    type: payload.type || payload.moduleType || payload.obj || eventName,
    content: payload.content || payload.text || payload.answer || ''
  };
  if (getPartText(streamPart)) {
    const kind = isToolMessage(streamPart) ? 'tool' : (isReasoningMessage(streamPart) ? 'reasoning' : 'answer');
    deltas.push({ text: getPartText(streamPart), kind });
  }

  return deltas;
}

/**
 * 判断流式文本增量是否可展示。
 * 输入: 文本分类和绑定展示开关。
 * 输出: 可作为 text_delta 输出时返回 true。
 */
function shouldShowStreamDelta(kind, { showToolMessages = false, showReasoning = false } = {}) {
  if (kind === 'tool') {
    return showToolMessages;
  }
  if (kind === 'reasoning') {
    return showReasoning;
  }
  return true;
}

/**
 * 读取 FastGPT 应用主动问候文本。
 * 输入: FastGPT 应用记录。
 * 输出: 去除首尾空白后的 welcomeText；未配置时返回空字符串。
 */
function getAppWelcomeText(app = {}) {
  return String(app?.chatConfig?.welcomeText || '').trim();
}

/**
 * 判断会话记录是否已经进入变量表单状态。
 * 输入: WecomBotConversation 记录。
 * 输出: 有 pending、已填变量或提示时间时返回 true。
 */
function hasConversationVariableState(conversation = {}) {
  const variableValues = conversation?.variableValues && typeof conversation.variableValues === 'object'
    ? conversation.variableValues
    : {};
  return Boolean(
    conversation?.pendingVariableForm ||
    Object.keys(variableValues).length ||
    conversation?.lastVariablePromptAt
  );
}

/**
 * 后端 FastGPT 调用适配器。
 * 输入: 配置、Apps 模型、HTTP 客户端和可选凭证解析器。
 * 输出: 提供 API Key 校验、应用可调用校验和消息发送方法的服务实例。
 */
class FastgptBotAdapter {
  /**
   * 创建 FastGPT Bot 适配器实例。
   * 输入: 可注入的配置、模型和 HTTP 客户端。
   * 输出: 可用于企业微信 Worker 或配置启用校验的适配器。
   */
  constructor({
    config = wecomBotConfig,
    AppsModel = Apps,
    ConversationModel = WecomBotConversation,
    secretService = createWecomBotSecretService(),
    axiosClient = axios,
    logger = defaultLogger(),
    now = defaultNow,
    createConversationId = generateFastgptChatId
  } = {}) {
    this.config = config;
    this.mediaUrlExtensions = resolveMediaUrlExtensionSets(config);
    this.AppsModel = AppsModel;
    this.ConversationModel = ConversationModel;
    this.secretService = secretService;
    this.axiosClient = axiosClient;
    this.logger = logger;
    this.now = now;
    this.createConversationId = typeof createConversationId === 'function'
      ? createConversationId
      : generateFastgptChatId;
  }

  /**
   * 解析 FastGPT API Key。
   * 输入: 可选绑定凭证和当前适配器配置中的明文 API Key。
   * 输出: 可用于 Bearer 调用的 API Key；缺失时抛出错误。
   */
  async resolveApiKey(fastgptCredentials = {}) {
    const bindingApiKey = fastgptCredentials?.apiKey;
    if (bindingApiKey) {
      return bindingApiKey;
    }

    const rawApiKey = this.config?.fastgpt?.apiKey;
    if (rawApiKey) {
      return rawApiKey;
    }

    throw new FastgptBotAdapterError('API_KEY_UNAVAILABLE', 'FastGPT API Key is not configured');
  }

  /**
   * 解析 FastGPT API 基础地址。
   * 输入: 可选绑定凭证和当前适配器配置中的 base URL。
   * 输出: 去除尾部斜杠后的 base URL；缺失时返回空字符串。
   */
  resolveApiBaseUrl(fastgptCredentials = {}) {
    return normalizeBaseUrl(fastgptCredentials?.apiBaseUrl || this.config?.fastgpt?.apiBaseUrl);
  }

  /**
   * 归一化 FastGPT 应用变量定义。
   * 输入: app.chatConfig.variables 或字段数组。
   * 输出: Worker 可消费的表单字段数组。
   */
  normalizeAppVariables(variables = []) {
    return normalizeFastgptVariables(variables);
  }

  /**
   * 读取 FastGPT 应用变量 schema。
   * 输入: FastGPT 应用 ID。
   * 输出: 归一化字段、schema hash 和应用记录。
   */
  async getAppVariableSchema(appId) {
    const app = await this.findCallableApp(appId);
    const fields = normalizeFastgptVariables(getOpeningPromptVariables(app));
    return {
      app,
      fields,
      schemaHash: createVariableSchemaHash(fields)
    };
  }

  /**
   * 读取 FastGPT 应用欢迎语。
   * 输入: FastGPT 应用 ID。
   * 输出: 可展示给企微用户的欢迎语；未配置时返回空字符串。
   */
  async getAppWelcomeText(appId) {
    const app = await this.findCallableApp(appId);
    return sanitizeVisibleText(getAppWelcomeText(app));
  }

  /**
   * 调用 FastGPT OpenAI 兼容聊天接口。
   * 输入: API 根路径、API Key 和聊天请求体。
   * 输出: FastGPT 原始响应数据；调用失败时向上抛出底层 HTTP 错误。
   */
  async postChatCompletion({ baseUrl, apiKey, body }) {
    const startedAt = this.now();
    const timeoutMs = this.config?.fastgpt?.chatTimeoutMs || DEFAULT_FASTGPT_CHAT_TIMEOUT_MS;
    const logMeta = buildFastgptRequestLogMeta({ baseUrl, apiKey, body, timeoutMs });
    writeStructuredLog(this.logger, 'info', '[FastGPT] chat completion started', logMeta);

    try {
      const response = await this.axiosClient.post(
        `${baseUrl}/v1/chat/completions`,
        body,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: timeoutMs
        }
      );

      writeStructuredLog(this.logger, 'info', '[FastGPT] chat completion finished', {
        ...logMeta,
        durationMs: this.now() - startedAt,
        status: response.status || 0,
        ...buildIdDiagnostics('responseId', response.data?.id),
        responseConversationIdSource: getConversationIdCandidate(response.data || {}).source,
        responseTextLength: this.extractReplyText(response.data || {}).length
      });

      return response.data;
    } catch (error) {
      writeStructuredLog(this.logger, 'warn', '[FastGPT] chat completion failed', {
        ...logMeta,
        durationMs: this.now() - startedAt,
        error: summarizeSafeError(error)
      });
      throw error;
    }
  }

  /**
   * 调用 FastGPT OpenAI 兼容流式聊天接口。
   * 输入: API 根路径、API Key 和带 stream=true 的聊天请求体。
   * 输出: HTTP 响应 data，可为 Node Readable、async iterable、字符串或 Buffer。
   */
  async postChatCompletionStream({ baseUrl, apiKey, body }) {
    const startedAt = this.now();
    const timeoutMs = this.config?.fastgpt?.chatTimeoutMs || DEFAULT_FASTGPT_CHAT_TIMEOUT_MS;
    const logMeta = buildFastgptRequestLogMeta({ baseUrl, apiKey, body, timeoutMs });
    writeStructuredLog(this.logger, 'info', '[FastGPT] streaming chat completion started', logMeta);

    try {
      const response = await this.axiosClient.post(
        `${baseUrl}/v1/chat/completions`,
        body,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: timeoutMs,
          responseType: 'stream'
        }
      );

      writeStructuredLog(this.logger, 'info', '[FastGPT] streaming chat completion connected', {
        ...logMeta,
        durationMs: this.now() - startedAt,
        status: response.status || 0
      });

      return response.data;
    } catch (error) {
      writeStructuredLog(this.logger, 'warn', '[FastGPT] streaming chat completion failed', {
        ...logMeta,
        durationMs: this.now() - startedAt,
        error: summarizeSafeError(error)
      });
      throw error;
    }
  }

  /**
   * 查询并校验可调用的 FastGPT 应用。
   * 输入: 绑定的 FastGPT 应用 ID。
   * 输出: 可调用的应用记录；不存在或未发布时抛出业务错误。
   */
  async findCallableApp(appId) {
    const app = await this.AppsModel.findById(appId).lean();
    if (!app) {
      throw new FastgptBotAdapterError('APP_NOT_FOUND', 'FastGPT app not found', { statusCode: 404 });
    }

    if (isExplicitlyUnavailable(app)) {
      throw new FastgptBotAdapterError('APP_UNPUBLISHED', 'FastGPT app is not published');
    }

    return app;
  }

  /**
   * 断言应用具备后端调用条件。
   * 输入: FastGPT 应用 ID。
   * 输出: 可调用的应用记录；API Key 或应用状态不可用时抛出错误。
   */
  async assertCallableApp(appId, fastgptCredentials = {}) {
    const app = await this.findCallableApp(appId);
    let apiKey;
    try {
      apiKey = await this.resolveApiKey(fastgptCredentials);
    } catch (error) {
      if (error instanceof FastgptBotAdapterError) {
        throw error;
      }
      throw new FastgptBotAdapterError('API_KEY_UNAVAILABLE', 'FastGPT API Key is not configured');
    }

    const baseUrl = this.resolveApiBaseUrl(fastgptCredentials);
    if (!baseUrl) {
      throw new FastgptBotAdapterError('FASTGPT_PROTOCOL_UNAVAILABLE', 'FastGPT API base URL is not configured');
    }

    try {
      await this.postChatCompletion({
        baseUrl,
        apiKey,
        body: {
          appId: app._id?.toString ? app._id.toString() : String(appId),
          chatId: '',
          customUid: FASTGPT_VALIDATION_USER_ID,
          messages: [{ role: 'user', content: 'ping' }]
        }
      });
    } catch (error) {
      throw new FastgptBotAdapterError(
        'FASTGPT_CREDENTIAL_UNAVAILABLE',
        'FastGPT API Base URL or OpenAPI Key is unavailable',
        {
          statusCode: 400,
          cause: error
        }
      );
    }

    return app;
  }

  /**
   * 调用 FastGPT 后端聊天接口发送用户消息。
   * 输入: 应用 ID、文本、稳定用户标识、可选会话 ID 和绑定 FastGPT 凭证。
   * 输出: FastGPT 后端响应数据；协议不可用或调用失败时抛出适配器错误。
   */
  async sendMessage({
    appId,
    text,
    fastgptUserId,
    conversationId = '',
    fastgptCredentials = {},
    media = [],
    image_url,
    file_url,
    variables = {},
    app: callableApp
  }) {
    const apiKey = await this.resolveApiKey(fastgptCredentials);
    const app = callableApp || await this.findCallableApp(appId);
    if (!fastgptUserId) {
      throw new FastgptBotAdapterError('FASTGPT_USER_REQUIRED', 'fastgptUserId is required');
    }

    const baseUrl = this.resolveApiBaseUrl(fastgptCredentials);
    if (!baseUrl) {
      throw new FastgptBotAdapterError('FASTGPT_PROTOCOL_UNAVAILABLE', 'FastGPT API base URL is not configured');
    }

    try {
      return await this.postChatCompletion({
        baseUrl,
        apiKey,
        body: {
          appId: app._id?.toString ? app._id.toString() : String(appId),
          chatId: conversationId,
          customUid: fastgptUserId,
          ...buildVariablesBody(variables),
          messages: [{
            role: 'user',
            content: buildFastgptMessageContent({
              text,
              media: normalizeMediaItems({ media, image_url, file_url })
            })
          }]
        }
      });
    } catch (error) {
      throw new FastgptBotAdapterError('FASTGPT_PROTOCOL_UNAVAILABLE', 'FastGPT backend protocol is unavailable', {
        statusCode: 502,
        cause: error
      });
    }
  }

  /**
   * 创建企微绑定侧维护的 FastGPT chatId。
   * 输入: 绑定、用户和 conversationKey 上下文，供测试或未来扩展注入使用。
   * 输出: 与 FastGPT getNanoid(24) 格式一致的非空 chatId。
   */
  createAppConversationId(context = {}) {
    const generated = toIdString(this.createConversationId(context)).trim();
    return FASTGPT_CHAT_ID_PATTERN.test(generated)
      ? generated
      : generateFastgptChatId(FASTGPT_CHAT_ID_SIZE);
  }

  /**
   * 读取或创建企业微信到 FastGPT 的会话映射。
   * 输入: binding、外部用户 ID、会话 Key 和 FastGPT 用户 ID。
   * 输出: 会话映射记录。
   */
  async findOrCreateConversation({ binding, externalUserId, conversationKey, fastgptUserId }) {
    const bindingId = toIdString(binding?._id || binding?.id || binding?.bindingId);
    const conversationContext = {
      binding,
      bindingId,
      externalUserId,
      conversationKey,
      fastgptUserId
    };
    if (typeof this.ConversationModel.findOne === 'function') {
      let findQuery = this.ConversationModel.findOne({
        bindingId,
        conversationKey
      });
      if (findQuery && typeof findQuery.lean === 'function') {
        findQuery = findQuery.lean();
      }
      const existing = await executeQuery(findQuery);

      if (existing) {
        if (toIdString(existing.fastgptUserId) !== fastgptUserId) {
          const appConversationId = this.createAppConversationId(conversationContext);
          const update = {
            $set: {
              externalUserId,
              fastgptUserId,
              appConversationId,
              lastMessageAt: new Date(),
              welcomePending: false,
              variableValues: {},
              pendingVariableForm: null,
              variableSchemaHash: '',
              lastVariablePromptAt: null
            }
          };
          await executeQuery(this.ConversationModel.updateOne({
            bindingId,
            conversationKey
          }, update));

          return {
            ...existing,
            externalUserId,
            fastgptUserId,
            appConversationId,
            lastMessageAt: update.$set.lastMessageAt,
            welcomePending: false,
            isNewConversation: false,
            shouldSendWelcomeText: true
          };
        }

        const existingConversationId = toIdString(existing.appConversationId).trim();
        if (!existingConversationId) {
          const appConversationId = this.createAppConversationId(conversationContext);
          const update = {
            $set: {
              externalUserId,
              fastgptUserId,
              appConversationId,
              lastMessageAt: new Date(),
              welcomePending: false
            }
          };
          await executeQuery(this.ConversationModel.updateOne({
            bindingId,
            conversationKey
          }, update));

          return {
            ...existing,
            externalUserId,
            fastgptUserId,
            appConversationId,
            lastMessageAt: update.$set.lastMessageAt,
            welcomePending: false,
            isNewConversation: false,
            shouldSendWelcomeText: Boolean(existing.welcomePending) || !hasConversationVariableState(existing)
          };
        }

        const lastMessageAt = new Date();
        await executeQuery(this.ConversationModel.updateOne({
          bindingId,
          conversationKey
        }, {
          $set: {
            externalUserId,
            fastgptUserId,
            lastMessageAt
          }
        }));

        return {
          ...existing,
          externalUserId,
          fastgptUserId,
          lastMessageAt,
          isNewConversation: false,
          shouldSendWelcomeText: Boolean(existing.welcomePending)
        };
      }
    }

    const appConversationId = this.createAppConversationId(conversationContext);
    const query = this.ConversationModel.findOneAndUpdate({
      bindingId,
      conversationKey
    }, {
      $setOnInsert: {
        bindingId,
        externalUserId,
        conversationKey,
        fastgptUserId,
        appConversationId
      },
      $set: {
        lastMessageAt: new Date()
      }
    }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    });

    if (query && typeof query.lean === 'function') {
      query.lean();
    }

    const conversation = await executeQuery(query);
    if (conversation && !toIdString(conversation.appConversationId).trim()) {
      await executeQuery(this.ConversationModel.updateOne({
        bindingId,
        conversationKey
      }, {
        $set: {
          appConversationId,
          lastMessageAt: new Date()
        }
      }));

      return {
        ...conversation,
        appConversationId,
        isNewConversation: true,
        shouldSendWelcomeText: true
      };
    }

    return conversation
      ? { ...conversation, isNewConversation: true, shouldSendWelcomeText: true }
      : conversation;
  }

  /**
   * 清除企业微信会话的待发送主动问候标记。
   * 输入: 绑定对象和 conversationKey。
   * 输出: Mongo 更新结果；缺失会话时幂等返回未匹配。
   */
  async clearBindingWelcomePending({ binding, conversationKey }) {
    const bindingId = toIdString(binding?._id || binding?.id || binding?.bindingId);
    return executeQuery(this.ConversationModel.updateOne({
      bindingId,
      conversationKey
    }, {
      $set: {
        welcomePending: false
      }
    }));
  }

  /**
   * 读取当前会话中的 FastGPT 变量状态。
   * 输入: 绑定对象和 conversationKey。
   * 输出: 已收集变量、待填写表单和 schema hash。
   */
  async getConversationVariableState({ binding, conversationKey }) {
    const bindingId = toIdString(binding?._id || binding?.id || binding?.bindingId);
    if (!bindingId || !conversationKey || typeof this.ConversationModel.findOne !== 'function') {
      return {
        variableValues: {},
        pendingVariableForm: null,
        variableSchemaHash: '',
        lastVariablePromptAt: null
      };
    }

    let query = this.ConversationModel.findOne({
      bindingId,
      conversationKey
    });
    if (query && typeof query.lean === 'function') {
      query = query.lean();
    }
    const conversation = await executeQuery(query);

    return {
      variableValues: conversation?.variableValues && typeof conversation.variableValues === 'object'
        ? { ...conversation.variableValues }
        : {},
      pendingVariableForm: conversation?.pendingVariableForm || null,
      variableSchemaHash: toIdString(conversation?.variableSchemaHash),
      lastVariablePromptAt: conversation?.lastVariablePromptAt || null
    };
  }

  /**
   * 保存当前会话中的 FastGPT 变量状态。
   * 输入: 绑定、用户、conversationKey 和变量状态。
   * 输出: 更新后的状态；无会话时会创建不含 FastGPT chatId 的状态记录。
   */
  async saveConversationVariableState({
    binding,
    externalUserId,
    conversationKey,
    fastgptUserId,
    variableValues = {},
    pendingVariableForm = null,
    variableSchemaHash = '',
    lastVariablePromptAt = new Date()
  }) {
    const bindingId = toIdString(binding?._id || binding?.id || binding?.bindingId);
    const update = {
      $setOnInsert: {
        bindingId,
        conversationKey,
        appConversationId: ''
      },
      $set: {
        externalUserId,
        fastgptUserId,
        variableValues,
        pendingVariableForm,
        variableSchemaHash,
        lastVariablePromptAt,
        lastMessageAt: new Date()
      }
    };
    const query = this.ConversationModel.findOneAndUpdate({
      bindingId,
      conversationKey
    }, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    });

    if (query && typeof query.lean === 'function') {
      query.lean();
    }

    return executeQuery(query);
  }

  /**
   * 清理当前会话中的 FastGPT 变量状态。
   * 输入: 绑定对象和 conversationKey。
   * 输出: Mongo 更新结果。
   */
  async clearConversationVariableState({ binding, conversationKey }) {
    const bindingId = toIdString(binding?._id || binding?.id || binding?.bindingId);
    return executeQuery(this.ConversationModel.updateOne({
      bindingId,
      conversationKey
    }, {
      $set: {
        variableValues: {},
        pendingVariableForm: null,
        variableSchemaHash: '',
        lastVariablePromptAt: null
      }
    }));
  }

  /**
   * 重置当前企业微信绑定会话的 FastGPT 会话 ID。
   * 输入: 绑定对象、外部用户 ID、会话 Key 和当前 FastGPT 用户 ID。
   * 输出: 幂等重置结果；会话不存在时 matchedCount 为 0 且不会创建新会话。
   */
  async resetBindingConversation({ binding, externalUserId, conversationKey, fastgptUserId }) {
    const bindingId = toIdString(binding?._id || binding?.id || binding?.bindingId);
    const appId = toIdString(binding?.appId);
    const appConversationId = this.createAppConversationId({
      binding,
      bindingId,
      externalUserId,
      conversationKey,
      fastgptUserId
    });
    const lastMessageAt = new Date();
    const result = await executeQuery(this.ConversationModel.updateOne({
      bindingId,
      conversationKey
    }, {
      $set: {
        externalUserId,
        fastgptUserId,
        appConversationId,
        lastMessageAt,
        welcomePending: true,
        variableValues: {},
        pendingVariableForm: null,
        variableSchemaHash: '',
        lastVariablePromptAt: null
      }
    }));

    return {
      reset: true,
      matchedCount: result?.matchedCount ?? result?.n ?? 0,
      modifiedCount: result?.modifiedCount ?? result?.nModified ?? 0,
      appConversationId,
      lastMessageAt,
      welcomeText: (result?.matchedCount ?? result?.n ?? 0) > 0 && appId
        ? sanitizeVisibleText(getAppWelcomeText(await this.findCallableApp(appId)))
        : ''
    };
  }

  /**
   * 从 FastGPT 响应中提取企业微信可回复文本。
   * 输入: FastGPT 原始响应和展示策略。
   * 输出: 过滤后的回复文本。
   */
  extractReplyText(responseData = {}, { showToolMessages = false, showReasoning = false } = {}) {
    return this.extractReplyBlocks(responseData, { showToolMessages, showReasoning })
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  /**
   * 从 FastGPT 响应中提取统一回复块。
   * 输入: FastGPT 原始响应和展示策略。
   * 输出: text/image/file 回复块数组，未知对象会被跳过。
   */
  extractReplyBlocks(responseData = {}, { showToolMessages = false, showReasoning = false } = {}) {
    const blocks = [];
    const choiceContent = responseData.choices?.[0]?.message?.content || responseData.choices?.[0]?.text;
    blocks.push(...extractBlocksFromContent(choiceContent, this.mediaUrlExtensions));

    const finalMediaBlocks = [];
    if (Array.isArray(responseData.responseData)) {
      responseData.responseData
        .filter((part) => (showToolMessages || !isToolMessage(part)))
        .filter((part) => (showReasoning || !isReasoningMessage(part)))
        .forEach((part) => {
          if (isFinalVisibleMediaPart(part)) {
            const mediaBlock = extractStructuredMediaBlock(part, this.mediaUrlExtensions);
            if (mediaBlock) {
              finalMediaBlocks.push(markReplyBlockSource(mediaBlock, 'finalMedia'));
            }
            return;
          }

          const partText = getPartText(part);
          if (partText && (
            String(part.type || '').toLowerCase().includes('answer') ||
            isToolMessage(part) ||
            isReasoningMessage(part)
          )) {
            blocks.push(...markReplyBlocksSource(extractBlocksFromText(partText, this.mediaUrlExtensions), 'responseData.answer'));
          }
          blocks.push(...markReplyBlocksSource(extractFormBlocksFromPayload(part), 'formControl'));
        });
    }

    blocks.push(...extractBlocksFromContent(responseData.answer, this.mediaUrlExtensions));
    blocks.push(...extractBlocksFromContent(responseData.data?.answer, this.mediaUrlExtensions));
    blocks.push(...extractBlocksFromContent(responseData.text, this.mediaUrlExtensions));
    blocks.push(...extractTopLevelFinalMediaBlocks(responseData, this.mediaUrlExtensions));
    if (!Array.isArray(responseData.responseData)) {
      blocks.push(...markReplyBlocksSource(extractFormBlocksFromPayload(responseData), 'formControl'));
    }
    blocks.push(...markReplyBlocksSource(extractFormBlocksFromPayload(responseData.data), 'formControl'));
    blocks.push(...finalMediaBlocks);

    return blocks.filter((block) => {
      if (block.type === 'text') {
        return Boolean(String(block.text || '').trim());
      }
      if (block.type === 'form') {
        return Array.isArray(block.fields) && block.fields.length > 0;
      }
      return Boolean(block.url);
    });
  }

  /**
   * 提取不丢失格式的最终回复文档。
   * 输入: FastGPT 原始响应和展示策略。
   * 输出: 原始可见 Markdown 与无正文位置的结构化媒体。
   */
  extractReplyDocument(responseData = {}, { showToolMessages = false, showReasoning = false } = {}) {
    const choiceContent = responseData.choices?.[0]?.message?.content || responseData.choices?.[0]?.text;
    const explicitPrimarySources = extractExplicitFinalReplyMarkdownSources(responseData);
    const primarySources = explicitPrimarySources.length
      ? explicitPrimarySources
      : [
        extractVisibleMarkdownParts(responseData.choices?.[0]?.text),
        extractVisibleMarkdownParts(responseData.text)
      ];
    const supplementalSources = [];
    const responseDataPrimaryParts = [];
    const responseDataSupplementalParts = [];
    const choiceMedia = extractStructuredReplyMedia(choiceContent, this.mediaUrlExtensions);
    const finalMedia = [];
    if (Array.isArray(responseData.responseData)) {
      responseData.responseData.forEach((part) => {
        const toolMessage = isToolMessage(part);
        const reasoningMessage = isReasoningMessage(part);
        if ((toolMessage && !showToolMessages) || (reasoningMessage && !showReasoning)) {
          return;
        }
        if (isFinalVisibleMediaPart(part)) {
          const block = extractStructuredMediaBlock(part, this.mediaUrlExtensions);
          if (block) {
            finalMedia.push(toReplyDocumentMedia(block, 'finalMedia'));
            return;
          }
        }

        const visibleParts = extractVisibleMarkdownParts(part);
        if (toolMessage || reasoningMessage) {
          responseDataSupplementalParts.push(...visibleParts);
        } else if (isFinalVisibleTextPart(part)) {
          responseDataPrimaryParts.push(...visibleParts);
        }
      });
    }

    if (!explicitPrimarySources.length) {
      primarySources.push(responseDataPrimaryParts);
    }
    supplementalSources.push(responseDataSupplementalParts);
    const topLevel = extractTopLevelFinalMediaBlocks(responseData, this.mediaUrlExtensions)
      .map((block) => toReplyDocumentMedia(block, 'topLevel'));
    return {
      markdown: composeFinalReplyMarkdown({ primarySources, supplementalSources }),
      structuredMedia: deduplicateReplyDocumentMedia([...choiceMedia, ...topLevel, ...finalMedia])
    };
  }

  /**
   * 使用企业微信绑定配置流式调用 FastGPT 并输出标准事件。
   * 输入: 绑定、文本、媒体、外部用户 ID、会话 Key 和 FastGPT 用户 ID。
   * 输出: async iterable，依次产出 text_delta、表单 reply_blocks、reply_document 和 done 事件。
   */
  async *streamBindingMessage({
    binding,
    text,
    media = [],
    image_url,
    file_url,
    variables = {},
    externalUserId,
    conversationKey,
    fastgptUserId
  }) {
    const bindingId = toIdString(binding?._id || binding?.id || binding?.bindingId);
    const appId = toIdString(binding?.appId);
    const displayOptions = {
      showToolMessages: Boolean(binding?.showToolMessages),
      showReasoning: Boolean(binding?.showReasoning)
    };
    let conversationId = '';
    let accumulatedStreamText = '';
    const accumulatedFinalMarkdownSources = [];
    const accumulatedSupplementalMarkdownSources = [];
    const accumulatedStructuredMedia = [];

    try {
      const conversation = await this.findOrCreateConversation({
        binding,
        externalUserId,
        conversationKey,
        fastgptUserId
      });
      conversationId = toIdString(conversation?.appConversationId).trim();

      const apiKey = await this.resolveApiKey({
        apiKey: this.secretService.decryptFastgptApiKey(binding)
      });
      const app = await this.findCallableApp(appId);
      const shouldSendWelcomeText = Boolean(conversation?.shouldSendWelcomeText || conversation?.isNewConversation);
      const welcomeText = shouldSendWelcomeText ? getAppWelcomeText(app) : '';
      if (welcomeText) {
        yield {
          type: 'welcome',
          text: sanitizeVisibleText(welcomeText)
        };
      }
      if (shouldSendWelcomeText) {
        await this.clearBindingWelcomePending({ binding, conversationKey });
      }
      if (!fastgptUserId) {
        throw new FastgptBotAdapterError('FASTGPT_USER_REQUIRED', 'fastgptUserId is required');
      }

      const baseUrl = this.resolveApiBaseUrl({
        apiBaseUrl: binding?.fastgptApiBaseUrl
      });
      if (!baseUrl) {
        throw new FastgptBotAdapterError('FASTGPT_PROTOCOL_UNAVAILABLE', 'FastGPT API base URL is not configured');
      }

      const stream = await this.postChatCompletionStream({
        baseUrl,
        apiKey,
        body: {
          appId: app._id?.toString ? app._id.toString() : String(appId),
          chatId: conversationId,
          customUid: fastgptUserId,
          stream: true,
          detail: true,
          ...buildVariablesBody(variables),
          messages: [{
            role: 'user',
            content: buildFastgptMessageContent({
              text,
              media: normalizeMediaItems({ media, image_url, file_url })
            })
          }]
        }
      });

      for await (const sseEvent of parseSseEvents(stream)) {
        const parsed = parseSsePayload(sseEvent.data);
        if (parsed.done) {
          break;
        }

        const payload = parsed.payload || {};
        if (sseEvent.event === 'error' || payload.error) {
          const message = payload.message || payload.error?.message || payload.error || 'FastGPT streaming error';
          yield {
            type: 'error',
            code: 'FASTGPT_PROTOCOL_UNAVAILABLE',
            message: sanitizeVisibleText(message),
            retryable: false
          };
          return;
        }

        const extractedReplyDocument = this.extractReplyDocument(payload, displayOptions);
        const explicitFinalMarkdown = composeFinalReplyMarkdown({
          primarySources: extractExplicitFinalReplyMarkdownSources(payload, {
            allowStandaloneTopLevelAnswer: false
          })
        });
        if (explicitFinalMarkdown) {
          accumulatedFinalMarkdownSources.push([explicitFinalMarkdown]);
        }
        accumulatedSupplementalMarkdownSources.push(
          ...extractSupplementalReplyMarkdownSources(payload, displayOptions)
        );
        accumulatedStructuredMedia.push(...extractedReplyDocument.structuredMedia);

        const deltas = extractStreamTextDeltas(sseEvent.event, payload)
          .filter((delta) => shouldShowStreamDelta(delta.kind, displayOptions))
          .map((delta) => ({
            type: 'text_delta',
            kind: delta.kind,
            text: delta.kind === 'answer'
              ? String(delta.text || '')
              : sanitizeVisibleText(delta.text)
          }))
          .filter((delta) => delta.text);
        for (const delta of deltas) {
          if (delta.kind === 'answer') {
            accumulatedStreamText += delta.text;
          }
          yield { type: delta.type, text: delta.text };
        }

        const extractedReplyBlocks = this.extractReplyBlocks(payload, displayOptions);
        const replyBlocks = sanitizeReplyBlocks(extractedReplyBlocks)
          .filter((block) => block.type === 'form');
        if (replyBlocks.length) {
          writeStructuredLog(this.logger, 'info', '[FastGPT] streaming reply blocks extracted', {
            bindingId,
            appId,
            replyBlockCount: replyBlocks.length,
            replyBlockSourceStats: buildReplyBlockSourceStats(extractedReplyBlocks)
          });
          yield {
            type: 'reply_blocks',
            replyBlocks
          };
        }
      }

      if (conversationId) {
        await executeQuery(this.ConversationModel.updateOne({
          bindingId,
          conversationKey
        }, {
          $set: {
            appConversationId: conversationId,
            lastMessageAt: new Date()
          }
        }));
      }

      const replyDocument = {
        // 主答案固定优先，补充调试正文按 SSE 遇到顺序追加并只在来源层面去重。
        markdown: composeFinalReplyMarkdown({
          primarySources: accumulatedFinalMarkdownSources.length
            ? accumulatedFinalMarkdownSources
            : [[accumulatedStreamText]],
          supplementalSources: deduplicateMarkdownPartsAcrossSources(
            accumulatedSupplementalMarkdownSources
          )
        }),
        structuredMedia: deduplicateReplyDocumentMedia(accumulatedStructuredMedia)
      };
      if (replyDocument.markdown || replyDocument.structuredMedia.length) {
        yield {
          type: 'reply_document',
          replyDocument
        };
      }

      yield {
        type: 'done',
        conversationId
      };
    } catch (error) {
      if (error instanceof FastgptBotAdapterError) {
        throw error;
      }

      throw new FastgptBotAdapterError(
        'FASTGPT_PROTOCOL_UNAVAILABLE',
        sanitizeVisibleText(error?.message || 'FastGPT backend protocol is unavailable'),
        {
          statusCode: 502,
          cause: error
        }
      );
    }
  }

  /**
   * 使用企业微信绑定配置调用 FastGPT 并维护会话映射。
   * 输入: 绑定、文本、外部用户 ID、会话 Key 和 FastGPT 用户 ID。
   * 输出: 企业微信可回复文本、无损回复文档、FastGPT 会话 ID 和原始响应。
   */
  async sendBindingMessage({
    binding,
    text,
    media = [],
    image_url,
    file_url,
    variables = {},
    externalUserId,
    conversationKey,
    fastgptUserId
  }) {
    const startedAt = this.now();
    const bindingId = toIdString(binding?._id || binding?.id || binding?.bindingId);
    const appId = toIdString(binding?.appId);
    writeStructuredLog(this.logger, 'info', '[FastGPT] binding message started', {
      bindingId,
      appId,
      conversationKeyPresent: Boolean(conversationKey),
      fastgptUserIdPresent: Boolean(fastgptUserId),
      textLength: String(text || '').length
    });

    const conversationStartedAt = this.now();
    const conversation = await this.findOrCreateConversation({
      binding,
      externalUserId,
      conversationKey,
      fastgptUserId
    });
    let conversationId = toIdString(conversation?.appConversationId).trim();
    writeStructuredLog(this.logger, 'info', '[FastGPT] conversation mapping finished', {
      bindingId,
      appId,
      durationMs: this.now() - conversationStartedAt,
      ...buildIdDiagnostics('appConversationId', conversationId)
    });

    const app = await this.findCallableApp(appId);
    const responseData = await this.sendMessage({
      appId,
      text,
      fastgptUserId,
      conversationId,
      media,
      image_url,
      file_url,
      variables,
      app,
      fastgptCredentials: {
        apiBaseUrl: binding?.fastgptApiBaseUrl,
        apiKey: this.secretService.decryptFastgptApiKey(binding)
      }
    });
    const welcomeText = (conversation?.shouldSendWelcomeText || conversation?.isNewConversation)
      ? sanitizeVisibleText(getAppWelcomeText(app))
      : '';
    const replyBlocks = this.extractReplyBlocks(responseData, {
      showToolMessages: Boolean(binding?.showToolMessages),
      showReasoning: Boolean(binding?.showReasoning)
    });
    const replyDocument = this.extractReplyDocument(responseData, {
      showToolMessages: Boolean(binding?.showToolMessages),
      showReasoning: Boolean(binding?.showReasoning)
    });
    const replyText = replyBlocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    writeStructuredLog(this.logger, 'info', '[FastGPT] binding message finished', {
      bindingId,
      appId,
      durationMs: this.now() - startedAt,
      conversationIdSource: getConversationIdCandidate(responseData).source,
      ...buildIdDiagnostics('conversationId', conversationId),
      replyTextLength: replyText.length,
      replyBlockSourceStats: buildReplyBlockSourceStats(replyBlocks)
    });

    if (conversation?.shouldSendWelcomeText || conversation?.isNewConversation) {
      await this.clearBindingWelcomePending({ binding, conversationKey });
    }

    return {
      welcomeText,
      replyText,
      replyBlocks,
      replyDocument,
      conversationId,
      rawResponse: responseData
    };
  }
}

module.exports = {
  FastgptBotAdapter,
  FastgptBotAdapterError
};
