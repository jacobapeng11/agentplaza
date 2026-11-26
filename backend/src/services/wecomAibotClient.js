const { wecomBotConfig } = require('../config/wecomBot');
const axios = require('axios');
const appLogger = require('../utils/logger');

const STREAM_ID_FACTORY_METHODS = ['generateReqId', 'generateRequestId', 'createReqId'];

/**
 * 规范化原生媒体降级错误码，避免透传第三方输入。
 * 输入: SDK 或底层异常的 code 值。
 * 输出: 最多 80 个字符的全大写业务标识符；无效值返回稳定默认错误码。
 */
function normalizeNativeMediaErrorCode(code) {
  return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)
    ? code
    : 'WECOM_NATIVE_MEDIA_SEND_FAILED';
}

/**
 * 企业微信智能机器人 SDK 适配错误。
 * 输入: 业务错误码、错误消息和可选底层原因。
 * 输出: 带 code/cause 的 Error 实例。
 */
class WecomAibotClientError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'WecomAibotClientError';
    this.code = code;
    this.cause = options.cause;
  }
}

/**
 * 加载企业微信智能机器人 SDK。
 * 输入: SDK 包名或导入路径。
 * 输出: SDK 模块；CommonJS 和 ESM 加载均失败时抛出可诊断错误。
 */
async function defaultLoadSdk(importPath = wecomBotConfig.sdkImportPath) {
  try {
    return require(importPath);
  } catch (requireError) {
    try {
      const dynamicImport = Function('specifier', 'return import(specifier)');
      return await dynamicImport(importPath);
    } catch (importError) {
      throw new WecomAibotClientError('WECOM_SDK_LOAD_FAILED', 'Unable to load WeCom AI bot SDK', {
        cause: importError || requireError
      });
    }
  }
}

/**
 * 从不同 SDK 导出形态中解析客户端构造器。
 * 输入: require/import 得到的 SDK 模块。
 * 输出: 可 new 的 SDK 客户端构造器或原始模块值。
 */
function getSdkConstructor(sdkModule) {
  return sdkModule?.WecomAibot ||
    sdkModule?.AibotClient ||
    sdkModule?.WSClient ||
    sdkModule?.default?.WSClient ||
    sdkModule?.['module.exports']?.WSClient ||
    sdkModule?.default ||
    sdkModule;
}

/**
 * 查找 SDK 提供的流式消息 ID 生成函数。
 * 输入: SDK 客户端实例或 SDK 模块导出对象。
 * 输出: 绑定好 this 的生成函数；未找到时返回 null。
 */
function getStreamIdFactory(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const methodName = STREAM_ID_FACTORY_METHODS.find((name) => typeof candidate[name] === 'function');
    if (methodName) {
      return candidate[methodName].bind(candidate);
    }
  }

  return null;
}

/**
 * 构建企业微信 SDK 客户端参数。
 * 输入: Bot 凭证和项目重试配置。
 * 输出: 可传给 SDK 构造器的连接、重连和鉴权重试参数。
 */
function buildSdkClientOptions({ botId, secret, config = wecomBotConfig }) {
  const retry = config?.retry || {};
  const sdk = config?.sdk || {};
  const options = {
    botId,
    secret
  };

  if (Number.isFinite(retry.maxAttempts)) {
    options.maxReconnectAttempts = retry.maxAttempts;
  }
  if (Number.isFinite(retry.baseDelayMs)) {
    options.reconnectInterval = retry.baseDelayMs;
  }
  if (Number.isFinite(retry.maxAuthFailureAttempts)) {
    options.maxAuthFailureAttempts = retry.maxAuthFailureAttempts;
  }
  if (Number.isFinite(sdk.heartbeatIntervalMs) && sdk.heartbeatIntervalMs > 0) {
    options.heartbeatInterval = sdk.heartbeatIntervalMs;
  }

  return options;
}

/**
 * 构建企业微信 SDK 日志适配器。
 * 输入: 项目统一日志器。
 * 输出: 带 AiBotSDK 前缀且遵循 LOG_LEVEL 的 SDK logger。
 */
function createSdkLogger(logger = appLogger) {
  return {
    debug: (...args) => logger.debug('[AiBotSDK]', ...args),
    info: (...args) => logger.info('[AiBotSDK]', ...args),
    warn: (...args) => logger.warn('[AiBotSDK]', ...args),
    error: (...args) => logger.error('[AiBotSDK]', ...args)
  };
}

/**
 * 从企业微信 payload 中读取媒体 ID。
 * 输入: SDK 原始消息体和媒体字段对象。
 * 输出: 媒体 ID 字符串；缺失返回空字符串。
 */
function getMediaId(body = {}, mediaBody = {}) {
  return mediaBody.media_id ||
    mediaBody.mediaId ||
    mediaBody.mediaid ||
    body.media_id ||
    body.mediaId ||
    body.mediaid ||
    body.mediaIdString ||
    '';
}

/**
 * 从企业微信 payload 中读取媒体 AES 密钥。
 * 输入: SDK 原始消息体和媒体字段对象。
 * 输出: AES 密钥字符串；缺失返回空字符串。
 */
function getMediaAesKey(body = {}, mediaBody = {}) {
  return mediaBody.aeskey ||
    mediaBody.aesKey ||
    mediaBody.aes_key ||
    mediaBody['aes-key'] ||
    body.aeskey ||
    body.aesKey ||
    body.aes_key ||
    body['aes-key'] ||
    '';
}

/**
 * 从文件名中读取扩展名。
 * 输入: 文件名。
 * 输出: 小写扩展名；缺失返回空字符串。
 */
function getExtension(name = '') {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

/**
 * 生成默认媒体文件名。
 * 输入: 媒体类型和文件扩展名。
 * 输出: 可用于后续 OSS 上传的文件名。
 */
function buildDefaultMediaName(kind, extension = '') {
  if (!extension && kind === 'image') {
    return 'image.jpg';
  }
  const suffix = extension ? `.${extension}` : '';
  return `${kind || 'media'}${suffix}`;
}

/**
 * 读取图文混排子项。
 * 输入: SDK mixed 消息体。
 * 输出: msg_item 数组；缺失时返回空数组。
 */
function getMixedItems(body = {}) {
  return Array.isArray(body.mixed?.msg_item) ? body.mixed.msg_item : [];
}

/**
 * 合并图文混排中的文本片段。
 * 输入: mixed.msg_item 子项数组。
 * 输出: 按原始顺序换行合并后的文本。
 */
function normalizeMixedText(items = []) {
  return items
    .filter((item) => String(item?.msgtype || '').toLowerCase() === 'text')
    .map((item) => {
      if (typeof item?.text === 'string') {
        return item.text.trim();
      }

      return String(item?.text?.content || '').trim();
    })
    .filter(Boolean)
    .join('\n');
}

// 作用：把企业微信 @ 成员结构归一化为可比较的字符串集合；输入为字符串、对象或数组；输出为字符串数组。
function normalizeMentionValue(value) {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return [value.trim()].filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeMentionValue(item));
  }
  if (typeof value === 'object') {
    return [
      value.userid,
      value.userId,
      value.id,
      value.botid,
      value.botId,
      value.aibotid,
      value.aibotId,
      value.name
    ].map((item) => String(item || '').trim()).filter(Boolean);
  }
  return [];
}

// 作用：展开企业微信 @ 字段的原始条目以保留对象和值的对应关系；输入为字符串、对象或数组；输出为扁平条目数组。
function flattenMentionEntries(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenMentionEntries(item));
  }
  return [value];
}

// 作用：读取消息中企业微信显式 @ 列表；输入为消息 body；输出为候选 @ 标识数组。
function getMentionEntries(body = {}) {
  const textPayload = typeof body.text === 'object' && body.text ? body.text : {};
  return [
    body.mentions,
    body.mentioned_list,
    body.mentionedList,
    body.at_list,
    body.atList,
    body.at_users,
    body.atUsers,
    body.atUserList,
    textPayload.mentioned_list,
    textPayload.mentionedList,
    textPayload.at_list,
    textPayload.atList,
    textPayload.at_users,
    textPayload.atUsers,
    textPayload.atUserList
  ].flatMap((item) => flattenMentionEntries(item));
}

// 作用：读取消息中企业微信显式 @ 列表；输入为消息 body；输出为候选 @ 标识数组。
function getMentionCandidates(body = {}) {
  return getMentionEntries(body).flatMap((item) => normalizeMentionValue(item));
}

// 作用：读取企业微信直接文本内容；输入为 SDK 原始消息体；输出为字符串文本，空 content 保持为空且不会返回对象。
function getDirectTextContent(body = {}) {
  const textPayload = body.text;
  if (textPayload && typeof textPayload === 'object') {
    if (Object.prototype.hasOwnProperty.call(textPayload, 'content')) {
      return textPayload.content == null ? '' : String(textPayload.content);
    }
    return '';
  }
  if (typeof textPayload === 'string') {
    return textPayload;
  }
  if (body.content == null || typeof body.content === 'object') {
    return '';
  }
  return String(body.content);
}

// 作用：读取企业微信文本内容；输入为 SDK 原始消息体；输出为可用于 @ 判定的文本字符串。
function getBodyTextContent(body = {}) {
  return getDirectTextContent(body) || normalizeMixedText(getMixedItems(body));
}

// 作用：读取当前机器人在回调中的标识；输入为消息 body；输出为候选机器人标识数组。
function getCurrentBotCandidates(body = {}) {
  return [
    body.aibotid,
    body.aibot_id,
    body.aibotId,
    body.botid,
    body.bot_id,
    body.botId,
    body.receiver?.aibotid,
    body.receiver?.botid,
    body.receiver?.userid
  ].map((item) => String(item || '').trim()).filter(Boolean);
}

// 作用：判断用户当前消息文本中是否包含可见 @ 片段；输入为文本；输出为是否存在 @xxx 形式片段。
function hasVisibleMentionText(text = '') {
  return /@\S+/.test(String(text || ''));
}

// 作用：判断是否为企业微信已路由到当前 AI Bot 的群聊回调；输入为消息 body；输出为缺少 @ 列表时的安全显式 @ 兜底判定。
function isCurrentBotRoutedGroupCallback(body = {}) {
  const chatType = body.chattype || body.chat_type || body.chatType || '';
  const responseUrl = body.response_url || body.responseUrl || body.response?.url || '';
  const text = String(getBodyTextContent(body) || '').trim();
  return chatType === 'group' &&
    getMentionEntries(body).length === 0 &&
    getCurrentBotCandidates(body).length > 0 &&
    Boolean(responseUrl) &&
    hasVisibleMentionText(text);
}

// 作用：判断显式 @ 列表是否包含当前机器人；输入为消息 body；输出为布尔值。
function isCurrentBotMentioned(body = {}) {
  const mentionEntries = getMentionEntries(body);
  const mentionSet = new Set(mentionEntries.flatMap((item) => normalizeMentionValue(item)));
  const metadataMentionsCurrentBot = getCurrentBotCandidates(body).some((botId) => mentionSet.has(botId));
  if (mentionEntries.length > 0) {
    return metadataMentionsCurrentBot;
  }

  return isCurrentBotRoutedGroupCallback(body);
}

// 作用：推导当前机器人可见 @ 名称；输入为消息 body；输出为可与文本开头 @ 片段比较的 token 数组。
function getCurrentBotVisibleMentionTokens(body = {}) {
  const currentBotCandidates = getCurrentBotCandidates(body);
  const currentBotSet = new Set(currentBotCandidates);
  const visibleTokens = new Set(currentBotCandidates);

  getMentionEntries(body).forEach((entry) => {
    if (typeof entry === 'string') {
      const value = entry.trim();
      if (currentBotSet.has(value)) {
        visibleTokens.add(value);
      }
      return;
    }

    if (!entry || typeof entry !== 'object') {
      return;
    }

    const mentionValues = normalizeMentionValue(entry);
    if (!mentionValues.some((value) => currentBotSet.has(value))) {
      return;
    }

    mentionValues.forEach((value) => visibleTokens.add(value));
    const name = String(entry.name || '').trim();
    if (name) {
      visibleTokens.add(name);
    }
  });

  return Array.from(visibleTokens).filter(Boolean);
}

// 作用：读取文本中的可见 @ 片段位置；输入为文本；输出为包含原文、token 和位置的数组。
function getVisibleMentionMatches(text = '') {
  const value = String(text || '');
  return Array.from(value.matchAll(/@\S+/g)).map((match) => ({
    raw: match[0],
    token: match[0].slice(1),
    index: match.index || 0
  }));
}

// 作用：按完整可见 @ token 寻找当前机器人 @ 片段；输入为文本和候选 token；输出为完整匹配位置或 null。
function findKnownVisibleMentionMatch(text = '', tokens = []) {
  const tokenSet = new Set(Array.from(new Set(tokens))
    .map((token) => String(token || '').trim())
    .filter(Boolean));

  return getVisibleMentionMatches(text).find((match) => tokenSet.has(match.token)) || null;
}

// 作用：清理删除 @ 后遗留的孤立 @ 和多余空白；输入为文本；输出为适合转发给 FastGPT 的文本。
function normalizeMentionStrippedText(text = '') {
  return String(text || '')
    .replace(/(^|\s)@\s+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

// 作用：从文本中删除指定可见 @ 片段；输入为原文本和匹配位置；输出为删除并清理后的文本。
function removeVisibleMentionMatch(text = '', match = null) {
  const value = String(text || '');
  if (!match) {
    return normalizeMentionStrippedText(value);
  }

  return normalizeMentionStrippedText(`${value.slice(0, match.index)}${value.slice(match.index + match.raw.length)}`);
}

// 作用：在已确认 @ 当前机器人后清理展示文本；输入为原文本和消息 body；输出为去掉当前机器人 @ 片段后的文本。
function stripCurrentBotMentionText(text, body = {}) {
  const value = String(text || '').trim();
  if (!value || !isCurrentBotMentioned(body)) {
    return value;
  }

  const visibleMatches = getVisibleMentionMatches(value);
  if (!visibleMatches.length) {
    return value;
  }

  const visibleTokens = getCurrentBotVisibleMentionTokens(body);
  const knownMatch = findKnownVisibleMentionMatch(value, visibleTokens);
  if (knownMatch) {
    return removeVisibleMentionMatch(value, knownMatch);
  }

  const mentionEntries = getMentionEntries(body);
  if (mentionEntries.length === 0 && isCurrentBotRoutedGroupCallback(body)) {
    return visibleMatches.length === 1 ? removeVisibleMentionMatch(value, visibleMatches[0]) : value;
  }

  if (mentionEntries.length > 0 && visibleMatches.length === 1) {
    return removeVisibleMentionMatch(value, visibleMatches[0]);
  }

  return value;
}

/**
 * 标准化图文混排中的单张图片。
 * 输入: mixed 图片子项和图片序号。
 * 输出: Worker 可消费的 image attachment；aesKey 和媒体 ID 保持不可枚举。
 */
function normalizeMixedImageAttachment(item = {}, index = 0) {
  const mediaBody = item.image || {};
  const extension = mediaBody.fileext || mediaBody.fileExt || '';
  const attachment = {
    kind: 'image',
    name: mediaBody.filename ||
      mediaBody.file_name ||
      mediaBody.name ||
      `image-${index + 1}${extension ? `.${extension}` : '.jpg'}`,
    mimeType: mediaBody.mimetype || mediaBody.mimeType || 'image/jpeg',
    size: Number(mediaBody.size || 0),
    downloadUrl: mediaBody.download_url || mediaBody.downloadUrl || mediaBody.url || ''
  };
  const mediaId = getMediaId({}, mediaBody);
  if (mediaId) {
    Object.defineProperty(attachment, 'wecomMediaId', {
      value: mediaId,
      enumerable: false,
      configurable: true
    });
  }
  const aesKey = getMediaAesKey({}, mediaBody);
  if (aesKey) {
    Object.defineProperty(attachment, 'aesKey', {
      value: aesKey,
      enumerable: false,
      configurable: true
    });
  }

  return attachment;
}

/**
 * 标准化图文混排中的非图片附件。
 * 输入: mixed 非文本非图片子项。
 * 输出: Worker 可消费的不支持附件元数据；aesKey 和媒体 ID 保持不可枚举。
 */
function normalizeMixedUnsupportedAttachment(item = {}) {
  const kind = String(item?.msgtype || 'unknown').toLowerCase();
  const mediaBody = item[kind] || {};
  const extension = mediaBody.fileext || mediaBody.fileExt || '';
  const attachment = {
    kind,
    name: mediaBody.filename ||
      mediaBody.file_name ||
      mediaBody.name ||
      buildDefaultMediaName(kind, extension),
    mimeType: mediaBody.mimetype || mediaBody.mimeType || '',
    size: Number(mediaBody.size || 0),
    downloadUrl: mediaBody.download_url || mediaBody.downloadUrl || mediaBody.url || ''
  };
  const mediaId = getMediaId({}, mediaBody);
  if (mediaId) {
    Object.defineProperty(attachment, 'wecomMediaId', {
      value: mediaId,
      enumerable: false,
      configurable: true
    });
  }
  const aesKey = getMediaAesKey({}, mediaBody);
  if (aesKey) {
    Object.defineProperty(attachment, 'aesKey', {
      value: aesKey,
      enumerable: false,
      configurable: true
    });
  }

  return attachment;
}

/**
 * 标准化图文混排中的媒体附件。
 * 输入: mixed.msg_item 子项数组。
 * 输出: 保持原始顺序的图片和不支持媒体 attachment 数组。
 */
function normalizeMixedAttachments(items = []) {
  let imageIndex = 0;
  return items
    .filter((item) => {
      const kind = String(item?.msgtype || '').toLowerCase();
      return kind && kind !== 'text';
    })
    .map((item) => {
      const kind = String(item?.msgtype || '').toLowerCase();
      if (kind === 'image') {
        const attachment = normalizeMixedImageAttachment(item, imageIndex);
        imageIndex += 1;
        return attachment;
      }

      return normalizeMixedUnsupportedAttachment(item);
    });
}

const UNSUPPORTED_QUOTE_TEXTS = new Set(['[该消息类型暂不能展示]']);
const SUPPORTED_QUOTE_MESSAGE_TYPES = new Set(['text', 'markdown', 'image', 'file', 'mixed']);
const SUPPORTED_MIXED_QUOTE_ITEM_TYPES = new Set(['text', 'image']);

/**
 * 复制附件上的隐藏媒体字段。
 * 输入: 目标附件和源附件。
 * 输出: 目标附件携带不可枚举的 wecomMediaId 和 aesKey。
 */
function copyHiddenMediaFields(target, source = {}) {
  ['wecomMediaId', 'aesKey'].forEach((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(source, field);
    if (descriptor) {
      Object.defineProperty(target, field, {
        ...descriptor,
        enumerable: false,
        configurable: true
      });
    }
  });
  return target;
}

/**
 * 标记附件来源并保留隐藏媒体字段。
 * 输入: 标准化附件和来源字符串。
 * 输出: 可安全序列化且保留隐藏下载凭证的附件。
 */
function withAttachmentSource(attachment = {}, source = 'message') {
  return copyHiddenMediaFields({
    ...attachment,
    source
  }, attachment);
}

/**
 * 判断显式引用类型是否允许进入上下文。
 * 输入: 引用消息类型。
 * 输出: text、markdown、image、file、mixed 返回 true，其它返回 false。
 */
function isSupportedQuoteMessageType(messageType = '') {
  return SUPPORTED_QUOTE_MESSAGE_TYPES.has(String(messageType || '').toLowerCase());
}

/**
 * 判断 mixed 引用是否只包含受支持内容。
 * 输入: mixed.msg_item 子项数组。
 * 输出: 仅包含 text/image 时返回 true，其它媒体类型返回 false。
 */
function hasOnlySupportedMixedQuoteItems(items = []) {
  return items.every((item) => SUPPORTED_MIXED_QUOTE_ITEM_TYPES.has(String(item?.msgtype || '').toLowerCase()));
}

/**
 * 推断引用消息类型。
 * 输入: 企业微信 quote 结构。
 * 输出: text、markdown、image、file、mixed 或 unknown。
 */
function inferQuoteMessageType(quote = {}) {
  const explicit = inferMessageType(quote);
  if (explicit && explicit !== 'unknown') {
    return isSupportedQuoteMessageType(explicit) ? explicit : 'unknown';
  }
  if (quote.markdown) return 'markdown';
  if (quote.mixed) return 'mixed';
  if (quote.image) return 'image';
  if (quote.file) return 'file';
  if (quote.text || quote.content) return 'text';
  return 'unknown';
}

/**
 * 判断引用文本是否为企微不可展示占位。
 * 输入: 引用文本。
 * 输出: 占位文本返回 true。
 */
function isUnsupportedQuoteText(text = '') {
  return UNSUPPORTED_QUOTE_TEXTS.has(String(text || '').trim());
}

/**
 * 读取引用消息文本。
 * 输入: 企业微信 quote 结构。
 * 输出: 可作为 FastGPT 上下文的纯文本；不可展示占位返回空字符串。
 */
function normalizeQuoteText(quote = {}) {
  const quoteType = inferQuoteMessageType(quote);
  if (quoteType === 'mixed') {
    const mixedItems = getMixedItems(quote);
    if (!hasOnlySupportedMixedQuoteItems(mixedItems)) {
      return '';
    }
    const mixedText = normalizeMixedText(mixedItems);
    return isUnsupportedQuoteText(mixedText) ? '' : mixedText;
  }
  if (quoteType === 'unknown') {
    return '';
  }
  const text = String(
    quote.markdown?.content ||
    quote.text?.content ||
    (typeof quote.text === 'string' ? quote.text : '') ||
    quote.content ||
    ''
  ).trim();
  return isUnsupportedQuoteText(text) ? '' : text;
}

/**
 * 读取引用消息附件。
 * 输入: 企业微信 quote 结构。
 * 输出: 标记 source=quote 的附件数组。
 */
function normalizeQuoteAttachments(quote = {}) {
  const quoteType = inferQuoteMessageType(quote);
  if (quoteType === 'mixed') {
    const mixedItems = getMixedItems(quote);
    if (!hasOnlySupportedMixedQuoteItems(mixedItems)) {
      return [];
    }
    return normalizeMixedAttachments(mixedItems)
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => withAttachmentSource(attachment, 'quote'));
  }
  if (quoteType === 'image' || quoteType === 'file') {
    return [withAttachmentSource(normalizeAttachment(quote, quoteType), 'quote')];
  }
  return [];
}

/**
 * 标准化企业微信引用消息。
 * 输入: 企业微信 body.quote 结构。
 * 输出: Worker 可消费的 quote 上下文；缺失 quote 时返回 null。
 */
function normalizeQuote(quote = {}) {
  if (!quote || typeof quote !== 'object') {
    return null;
  }
  const messageType = inferQuoteMessageType(quote);
  const text = normalizeQuoteText(quote);
  const attachments = normalizeQuoteAttachments(quote);
  if (!text && !attachments.length) {
    return null;
  }
  return {
    messageType,
    text,
    attachments
  };
}

/**
 * 推断企业微信消息类型。
 * 输入: SDK 消息体。
 * 输出: text/image/file 或 unknown，用于兼容分类型事件缺少 msgtype 的场景。
 */
function inferMessageType(body = {}) {
  if (body.event?.template_card_event ||
    body.template_card_event ||
    body.event_type === 'template_card_event' ||
    body.event?.event_key ||
    body.event?.eventKey ||
    body.event?.task_id ||
    body.event?.taskId) {
    return 'template_card_event';
  }

  return body.msgtype ||
    body.message_type ||
    body.messageType ||
    body.type ||
    (body.image ? 'image' : '') ||
    (body.file ? 'file' : '') ||
    (body.text ? 'text' : 'unknown');
}

/**
 * 读取模板卡片事件字段。
 * 输入: SDK 原始消息体。
 * 输出: eventKey、taskId 和事件对象。
 */
function getTemplateCardEvent(body = {}) {
  const event = body.event?.template_card_event ||
    body.template_card_event ||
    body.event ||
    {};
  return {
    event,
    eventKey: event.event_key || event.eventKey || event.key || event.value || body.event_key || body.eventKey || '',
    taskId: event.task_id || event.taskId || body.task_id || body.taskId || ''
  };
}

/**
 * 标准化企业微信媒体附件。
 * 输入: SDK 消息体和消息类型。
 * 输出: Worker 可消费的附件元数据；媒体 ID 和 aesKey 保留为不可枚举字段。
 */
function normalizeAttachment(body = {}, messageType = '') {
  const kind = String(messageType || '').toLowerCase();
  const mediaBody = body[kind] || body.file || body.image || {};
  const name = mediaBody.filename ||
    mediaBody.file_name ||
    mediaBody.name ||
    body.filename ||
    body.fileName ||
    buildDefaultMediaName(kind, mediaBody.fileext || body.fileext || '');
  const attachment = {
    kind,
    name,
    mimeType: mediaBody.mimetype || mediaBody.mimeType || body.mimetype || body.mimeType || (kind === 'image' ? 'image/jpeg' : ''),
    size: Number(mediaBody.size || body.size || 0),
    downloadUrl: mediaBody.download_url || mediaBody.downloadUrl || mediaBody.url || body.download_url || body.downloadUrl || ''
  };
  const mediaId = getMediaId(body, mediaBody);
  if (mediaId) {
    Object.defineProperty(attachment, 'wecomMediaId', {
      value: mediaId,
      enumerable: false,
      configurable: true
    });
  }
  const aesKey = getMediaAesKey(body, mediaBody);
  if (aesKey) {
    Object.defineProperty(attachment, 'aesKey', {
      value: aesKey,
      enumerable: false,
      configurable: true
    });
  }

  return attachment;
}

/**
 * 生成媒体诊断摘要。
 * 输入: 附件数组。
 * 输出: 不包含媒体 ID 和原始文件名的安全摘要数组。
 */
function buildMediaSummary(attachments = []) {
  return attachments.map((attachment) => ({
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    size: attachment.size,
    extension: getExtension(attachment.name)
  }));
}

/**
 * 标准化企业微信入站消息。
 * 输入: SDK 原始消息 payload。
 * 输出: Worker 可消费的 messageId、text、externalUserId、chatType 和 raw 字段。
 */
function normalizeMessage(payload = {}) {
  const body = payload.body || payload;
  const botCandidates = getCurrentBotCandidates(body);
  const mentionedCurrentBot = isCurrentBotMentioned(body);
  const messageType = inferMessageType(body);
  const templateCardEvent = messageType === 'template_card_event'
    ? getTemplateCardEvent(body)
    : null;
  const mixedItems = messageType === 'mixed' ? getMixedItems(body) : [];
  const mixedText = messageType === 'mixed' ? normalizeMixedText(mixedItems) : '';
  const textSource = mixedText || templateCardEvent?.eventKey || getDirectTextContent(body);
  const normalized = {
    messageId: body.msgid || body.message_id || body.messageId || body.id || '',
    messageType,
    text: textSource,
    botId: botCandidates[0] || '',
    mentionedCurrentBot,
    textWithoutBotMention: stripCurrentBotMentionText(textSource, body),
    externalUserId: body.from?.userid || body.from_userid || body.externalUserId || body.userId || '',
    chatType: body.chattype === 'single' || body.chat_type === 'single' || body.chatType === 'single'
      ? 'private'
      : (body.chattype || body.chat_type || body.chatType || 'unknown'),
    chatId: body.chatid || body.chat_id || body.chatId || body.conversation_id || '',
    raw: payload,
    sourceFrame: payload
  };
  if (templateCardEvent) {
    normalized.eventKey = templateCardEvent.eventKey;
    normalized.taskId = templateCardEvent.taskId;
    normalized.templateCardEvent = templateCardEvent.event;
  }
  const attachments = [];
  if (messageType === 'image' || messageType === 'file') {
    attachments.push(withAttachmentSource(normalizeAttachment(body, messageType), 'message'));
  }
  if (messageType === 'mixed') {
    attachments.push(...normalizeMixedAttachments(mixedItems).map((attachment) => withAttachmentSource(attachment, 'message')));
  }

  const quote = normalizeQuote(body.quote);
  if (quote) {
    normalized.quote = quote;
    attachments.push(...quote.attachments);
  }

  if (attachments.length) {
    normalized.attachments = attachments;
    normalized.mediaSummary = buildMediaSummary(normalized.attachments);
  }

  return normalized;
}

/**
 * 读取流式回复所需的原始入站 frame。
 * 输入: 标准化消息或 SDK 原始消息。
 * 输出: 可传给企业微信 SDK 流式回复方法的原始 frame。
 */
function getStreamSourceFrame(message = {}) {
  return message.sourceFrame || message.raw || message;
}

/**
 * 调用企业微信 SDK 流式方法并兼容对象参数形态。
 * 输入: SDK 方法、原始 frame、streamId、内容和结束标记。
 * 输出: SDK 调用结果；位置参数不可用时重试对象参数。
 */
async function callStreamMethod(method, sourceFrame, streamId, content, finish) {
  try {
    return await method(sourceFrame, streamId, content, finish);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    return method({
      message: sourceFrame,
      sourceFrame,
      streamId,
      content,
      finish
    });
  }
}

/**
 * 把企微明确返回的非零错误码转换为稳定业务错误。
 * 输入: 企业微信 SDK 的 Markdown 或流式发送结果。
 * 输出: 原始成功结果；明确非零 errcode 时抛出 WECOM_MARKDOWN_SEND_FAILED。
 */
function assertSuccessfulMarkdownResult(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, 'errcode') && Number(result.errcode) !== 0) {
    throw new WecomAibotClientError(
      'WECOM_MARKDOWN_SEND_FAILED',
      'WeCom Markdown message was rejected'
    );
  }
  return result;
}

/**
 * 读取企业微信发送目标。
 * 输入: 标准化消息上下文。
 * 输出: chatId 或用户 ID；缺失返回空字符串。
 */
function getSendTarget(message = {}) {
  return message?.chatId || message?.chatid || message?.externalUserId || message?.userId || '';
}

/**
 * 归一化下载媒体结果。
 * 输入: SDK 或 HTTP 下载返回值和附件元数据。
 * 输出: 包含 buffer、filename、mimeType、size 的对象。
 */
function normalizeDownloadedMedia(result, attachment = {}) {
  const data = result?.data !== undefined ? result.data : result;
  const buffer = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data?.buffer || data?.content || data || '');

  return {
    buffer,
    filename: data?.filename || data?.name || attachment.name || 'media.bin',
    mimeType: data?.mimeType || data?.mimetype || attachment.mimeType || '',
    size: Number(data?.size || attachment.size || buffer.length)
  };
}

/**
 * 生成媒体文本链接降级内容。
 * 输入: 媒体类型和媒体信息。
 * 输出: 可发送给企业微信的 Markdown 文本。
 */
function buildMediaLinkText(kind, media) {
  const mediaObject = typeof media === 'string' ? { url: media } : (media || {});
  const url = mediaObject.url || mediaObject.ossUrl || String(media || '');
  return String(url || mediaObject.name || mediaObject.filename || kind || '').trim();
}

/**
 * 生成模板卡片文本降级内容。
 * 输入: 模板卡片对象和可选兜底文本。
 * 输出: 可直接发送给企业微信的文本内容。
 */
function buildTemplateCardFallbackText(card = {}, fallbackText = '') {
  const optionLines = Array.isArray(card.options)
    ? card.options.map((option, index) => `${index + 1}. ${option.label || option.value || option}`).join('\n')
    : '';
  return String(
    fallbackText ||
    card.fallbackText ||
    [card.title, card.description, optionLines].filter(Boolean).join('\n') ||
    ''
  ).trim();
}

/**
 * 调用模板卡片 SDK 方法并兼容对象参数形态。
 * 输入: SDK 方法、原始 frame 和卡片参数。
 * 输出: SDK 调用结果。
 */
async function callTemplateCardMethod(method, sourceFrame, card) {
  try {
    return await method(sourceFrame, card);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    return method({
      message: sourceFrame,
      sourceFrame,
      card
    });
  }
}

/**
 * 调用流式带卡片 SDK 方法并兼容对象参数形态。
 * 输入: SDK 方法、原始 frame、streamId、内容和卡片。
 * 输出: SDK 调用结果。
 */
async function callStreamWithCardMethod(method, sourceFrame, streamId, content, card) {
  try {
    return await method(sourceFrame, streamId, content, card);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    return method({
      message: sourceFrame,
      sourceFrame,
      streamId,
      content,
      card
    });
  }
}

/**
 * 从 URL 中读取文件名。
 * 输入: 媒体 URL 和兜底文件名。
 * 输出: URL 路径末段文件名；解析失败时返回兜底值。
 */
function getNameFromUrl(url, fallback) {
  try {
    const parsed = new URL(String(url || ''));
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '') || fallback;
  } catch (error) {
    return fallback;
  }
}

/**
 * 解析出站媒体文件名。
 * 输入: 媒体对象和兜底文件名。
 * 输出: 可传给企微上传接口的文件名。
 */
function resolveOutboundMediaFilename(media, fallback) {
  const mediaObject = typeof media === 'string' ? { url: media } : (media || {});
  return String(
    mediaObject.name ||
    mediaObject.filename ||
    getNameFromUrl(mediaObject.url || mediaObject.ossUrl, fallback) ||
    fallback
  ).trim();
}

/**
 * 企业微信智能机器人 SDK 客户端适配层。
 * 输入: 可注入的 SDK 加载函数。
 * 输出: 提供连接、消息绑定、文本发送和关闭清理能力的客户端实例。
 */
class WecomAibotClient {
  /**
   * 创建企业微信 SDK 客户端适配器。
   * 输入: SDK 加载函数，默认读取配置中的 SDK 导入路径。
   * 输出: 尚未连接的客户端适配器。
   */
  constructor({ loadSdk = defaultLoadSdk, config = wecomBotConfig, axiosClient = axios } = {}) {
    this.loadSdk = loadSdk;
    this.config = config;
    this.axiosClient = axiosClient;
    this.sdkModule = null;
    this.sdkClient = null;
    this.cleanupHandlers = [];
  }

  /**
   * 连接并订阅企业微信智能机器人消息。
   * 输入: Bot ID、Secret、可选消息回调和连接错误回调。
   * 输出: 已连接的当前客户端实例；SDK 加载或构造失败时抛出错误。
   */
  async connect({ botId, secret, onMessage, onError, onClose, onAuthenticated, onReconnecting, onDisconnected }) {
    let sdkModule;
    try {
      sdkModule = await this.loadSdk();
    } catch (error) {
      if (error instanceof WecomAibotClientError) {
        throw error;
      }
      throw new WecomAibotClientError('WECOM_SDK_LOAD_FAILED', 'Unable to load WeCom AI bot SDK', { cause: error });
    }

    const SdkClient = getSdkConstructor(sdkModule);
    if (typeof SdkClient !== 'function') {
      throw new WecomAibotClientError('WECOM_SDK_LOAD_FAILED', 'WeCom AI bot SDK does not expose a client constructor');
    }

    this.sdkModule = sdkModule;
    this.sdkClient = new SdkClient({
      ...buildSdkClientOptions({ botId, secret, config: this.config }),
      logger: createSdkLogger()
    });

    if (typeof this.sdkClient.on === 'function') {
      if (typeof onAuthenticated === 'function') {
        this.bindLifecycleHandler('authenticated', onAuthenticated);
      }
      if (typeof onReconnecting === 'function') {
        this.bindLifecycleHandler('reconnecting', onReconnecting);
      }
      if (typeof onDisconnected === 'function') {
        this.bindLifecycleHandler('disconnected', onDisconnected);
      }
    }

    if (typeof this.sdkClient.connect === 'function') {
      await this.sdkClient.connect();
    }

    if (typeof this.sdkClient.subscribe === 'function') {
      await this.sdkClient.subscribe();
    }

    if (typeof onMessage === 'function' && typeof this.sdkClient.on === 'function') {
      this.bindMessageHandler('message', onMessage);
      this.bindMessageHandler('message.text', onMessage);
      this.bindMessageHandler('message.image', onMessage);
      this.bindMessageHandler('message.file', onMessage);
      this.bindMessageHandler('event.template_card_event', onMessage);
    }

    if (typeof onError === 'function' && typeof this.sdkClient.on === 'function') {
      this.bindLifecycleHandler('error', onError);
    }

    if (typeof onClose === 'function' && typeof this.sdkClient.on === 'function') {
      this.bindLifecycleHandler('close', onClose);
      this.bindLifecycleHandler('disconnect', onClose);
    }

    return this;
  }

  /**
   * 绑定 SDK 消息事件并记录清理函数。
   * 输入: SDK 事件名和业务消息回调。
   * 输出: 无返回值；关闭时会解除对应事件监听。
   */
  bindMessageHandler(eventName, onMessage) {
    const handler = (payload) => onMessage(normalizeMessage(payload));
    const cleanup = this.sdkClient.on(eventName, handler);
    if (typeof cleanup === 'function') {
      this.cleanupHandlers.push(cleanup);
    } else if (typeof this.sdkClient.off === 'function') {
      this.cleanupHandlers.push(() => this.sdkClient.off(eventName, handler));
    }
  }

  /**
   * 绑定 SDK 生命周期事件并记录清理函数。
   * 输入: SDK 事件名和业务生命周期回调。
   * 输出: 无返回值；关闭时解除对应事件监听。
   */
  bindLifecycleHandler(eventName, callback) {
    const cleanup = this.sdkClient.on(eventName, callback);
    if (typeof cleanup === 'function') {
      this.cleanupHandlers.push(cleanup);
    } else if (typeof this.sdkClient.off === 'function') {
      this.cleanupHandlers.push(() => this.sdkClient.off(eventName, callback));
    }
  }

  /**
   * 通过 SDK 向企业微信发送文本回复。
   * 输入: 标准化消息上下文和回复文本。
   * 输出: SDK 发送结果；客户端未连接或缺少发送目标时抛出错误。
   */
  async sendText(message, text) {
    if (!this.sdkClient) {
      throw new WecomAibotClientError('WECOM_SDK_SEND_UNAVAILABLE', 'WeCom SDK sendText is unavailable');
    }

    if (typeof this.sdkClient.sendText === 'function') {
      return assertSuccessfulMarkdownResult(await this.sdkClient.sendText(message, text));
    }

    if (typeof this.sdkClient.sendMessage === 'function') {
      const chatId = getSendTarget(message);
      if (!chatId) {
        throw new WecomAibotClientError('WECOM_SDK_SEND_UNAVAILABLE', 'WeCom SDK send target is unavailable');
      }

      return assertSuccessfulMarkdownResult(await this.sdkClient.sendMessage(chatId, {
        msgtype: 'markdown',
        markdown: { content: text }
      }));
    }

    throw new WecomAibotClientError('WECOM_SDK_SEND_UNAVAILABLE', 'WeCom SDK sendText is unavailable');
  }

  /**
   * 创建企业微信流式回复请求 ID。
   * 输入: 可选 ID 前缀，默认 stream。
   * 输出: SDK 生成的请求 ID；SDK 缺少能力时返回可诊断的本地兜底 ID。
   */
  createStreamId(prefix = 'stream') {
    const streamIdFactory = getStreamIdFactory(
      this.sdkClient,
      this.sdkModule,
      this.sdkModule?.default,
      this.sdkModule?.['module.exports']
    );

    if (streamIdFactory) {
      return streamIdFactory(prefix);
    }

    const safePrefix = String(prefix || 'stream').replace(/[^a-zA-Z0-9_-]/g, '-');
    return `${safePrefix}-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * 发送企业微信阻塞式流式回复片段。
   * 输入: 标准化消息、streamId、内容和 finish 结束标记。
   * 输出: SDK 流式回复结果；SDK 缺少能力时报 WECOM_SDK_STREAM_UNAVAILABLE。
   */
  async replyStream(message, { streamId, content, finish = false } = {}) {
    if (!this.sdkClient || typeof this.sdkClient.replyStream !== 'function') {
      throw new WecomAibotClientError(
        'WECOM_SDK_STREAM_UNAVAILABLE',
        'WeCom SDK replyStream is unavailable'
      );
    }

    return assertSuccessfulMarkdownResult(await callStreamMethod(
      this.sdkClient.replyStream.bind(this.sdkClient),
      getStreamSourceFrame(message),
      streamId,
      content,
      finish
    ));
  }

  /**
   * 发送企业微信非阻塞式流式回复片段。
   * 输入: 标准化消息、streamId、内容和 finish 结束标记。
   * 输出: SDK 非阻塞流式结果；SDK 缺少非阻塞能力时等待阻塞式回复。
   */
  async replyStreamNonBlocking(message, options = {}) {
    if (this.sdkClient && typeof this.sdkClient.replyStreamNonBlocking === 'function') {
      return assertSuccessfulMarkdownResult(await callStreamMethod(
        this.sdkClient.replyStreamNonBlocking.bind(this.sdkClient),
        getStreamSourceFrame(message),
        options.streamId,
        options.content,
        options.finish === undefined ? false : options.finish
      ));
    }

    return this.replyStream(message, options);
  }

  /**
   * 通过原始回调帧更新群聊唯一引用气泡。
   * 输入: 标准化群聊消息、streamId、Markdown 内容和 finish 标记。
   * 输出: SDK 被动流式回复结果；缺少群聊引用上下文时抛出稳定错误。
   */
  async replyGroupBubble(message, { streamId, content, finish = false } = {}) {
    const sourceFrame = getStreamSourceFrame(message);
    if (message?.chatType !== 'group' ||
      !sourceFrame?.headers?.req_id ||
      !String(streamId || '').trim()) {
      throw new WecomAibotClientError(
        'WECOM_GROUP_REPLY_CONTEXT_MISSING',
        'WeCom group passive reply context is unavailable'
      );
    }

    try {
      return await this.replyStreamNonBlocking(message, { streamId, content, finish });
    } catch (error) {
      if (error?.code === 'WECOM_SDK_STREAM_UNAVAILABLE') {
        throw new WecomAibotClientError(
          'WECOM_GROUP_REPLY_CONTEXT_MISSING',
          'WeCom group passive stream capability is unavailable'
        );
      }
      throw error;
    }
  }

  /**
   * 回复企业微信模板卡片，SDK 缺失时按文本降级。
   * 输入: 标准化消息和模板卡片对象。
   * 输出: SDK 卡片发送结果；降级时返回 downgraded=true。
   */
  async replyTemplateCard(message, card = {}) {
    if (this.sdkClient && typeof this.sdkClient.replyTemplateCard === 'function') {
      return callTemplateCardMethod(
        this.sdkClient.replyTemplateCard.bind(this.sdkClient),
        getStreamSourceFrame(message),
        card
      );
    }

    const fallbackText = buildTemplateCardFallbackText(card);
    if (fallbackText) {
      await this.sendText(message, fallbackText);
      return { downgraded: true };
    }

    throw new WecomAibotClientError(
      'WECOM_SDK_TEMPLATE_CARD_UNAVAILABLE',
      'WeCom SDK replyTemplateCard is unavailable'
    );
  }

  /**
   * 发送带模板卡片的企业微信流式回复，SDK 缺失时按文本降级。
   * 输入: 标准化消息、streamId、内容和模板卡片。
   * 输出: SDK 调用结果；降级时返回 downgraded=true。
   */
  async replyStreamWithCard(message, { streamId, content = '', card = {} } = {}) {
    if (this.sdkClient && typeof this.sdkClient.replyStreamWithCard === 'function') {
      return callStreamWithCardMethod(
        this.sdkClient.replyStreamWithCard.bind(this.sdkClient),
        getStreamSourceFrame(message),
        streamId,
        content,
        card
      );
    }

    const fallbackText = buildTemplateCardFallbackText(card, content);
    if (fallbackText) {
      await this.sendText(message, fallbackText);
      return { downgraded: true };
    }

    throw new WecomAibotClientError(
      'WECOM_SDK_TEMPLATE_CARD_UNAVAILABLE',
      'WeCom SDK replyStreamWithCard is unavailable'
    );
  }

  /**
   * 更新企业微信模板卡片，SDK 缺失时发送文本确认。
   * 输入: 标准化消息和模板卡片对象。
   * 输出: SDK 更新结果；降级时返回 downgraded=true。
   */
  async updateTemplateCard(message, card = {}) {
    if (this.sdkClient && typeof this.sdkClient.updateTemplateCard === 'function') {
      return callTemplateCardMethod(
        this.sdkClient.updateTemplateCard.bind(this.sdkClient),
        getStreamSourceFrame(message),
        card
      );
    }

    const fallbackText = buildTemplateCardFallbackText(card);
    if (fallbackText) {
      await this.sendText(message, fallbackText);
      return { downgraded: true };
    }

    throw new WecomAibotClientError(
      'WECOM_SDK_TEMPLATE_CARD_UNAVAILABLE',
      'WeCom SDK updateTemplateCard is unavailable'
    );
  }

  /**
   * 判断当前 SDK 客户端是否具备企微流式回复能力。
   * 输入: 已连接的 SDK 客户端。
   * 输出: 同时具备 streamId 生成和 replyStream 能力时返回 true。
   */
  supportsStreaming() {
    const hasStreamIdFactory = Boolean(getStreamIdFactory(
      this.sdkClient,
      this.sdkModule,
      this.sdkModule?.default,
      this.sdkModule?.['module.exports']
    ));
    const hasReplyStream = Boolean(this.sdkClient && (
      typeof this.sdkClient.replyStream === 'function' ||
      typeof this.sdkClient.replyStreamNonBlocking === 'function'
    ));

    return hasStreamIdFactory && hasReplyStream;
  }

  /**
   * 下载企业微信媒体内容。
   * 输入: 标准化附件或包含 wecomMediaId/downloadUrl/aesKey 的对象。
   * 输出: buffer、filename、mimeType 和 size；SDK 不支持时抛出可诊断错误。
   */
  async downloadMedia(attachment = {}) {
    const mediaId = attachment.wecomMediaId || attachment.mediaId;
    const downloadUrl = attachment.downloadUrl || attachment.url;
    const aesKey = attachment.aesKey || attachment.aeskey || attachment.aes_key || attachment['aes-key'];
    try {
      if (this.sdkClient && typeof this.sdkClient.downloadFile === 'function' && downloadUrl) {
        const result = await this.sdkClient.downloadFile(downloadUrl, aesKey);
        return normalizeDownloadedMedia(result, attachment);
      }

      const downloadMethods = ['downloadMedia', 'getMedia', 'getMediaFile'];
      const methodName = this.sdkClient && downloadMethods.find((name) => typeof this.sdkClient[name] === 'function');

      if (methodName) {
        const result = await this.sdkClient[methodName](mediaId || attachment);
        return normalizeDownloadedMedia(result, attachment);
      }

      if (this.sdkClient && typeof this.sdkClient.downloadFile === 'function' && mediaId) {
        const result = await this.sdkClient.downloadFile(mediaId, aesKey);
        return normalizeDownloadedMedia(result, attachment);
      }

      if (downloadUrl && this.axiosClient && typeof this.axiosClient.get === 'function') {
        const response = await this.axiosClient.get(downloadUrl, {
          responseType: 'arraybuffer',
          timeout: this.config?.media?.downloadTimeoutMs || 10000
        });
        return normalizeDownloadedMedia({
          buffer: Buffer.from(response.data || ''),
          mimeType: response.headers?.['content-type'] || attachment.mimeType
        }, attachment);
      }

      throw new WecomAibotClientError(
        'WECOM_SDK_MEDIA_DOWNLOAD_UNAVAILABLE',
        'WeCom SDK media download API is unavailable'
      );
    } catch (error) {
      if (error instanceof WecomAibotClientError) {
        throw error;
      }
      throw new WecomAibotClientError('WECOM_SDK_MEDIA_DOWNLOAD_FAILED', 'WeCom SDK media download failed', {
        cause: error
      });
    }
  }

  /**
   * 解析出站媒体 buffer。
   * 输入: 媒体对象或 URL。
   * 输出: 可上传到企业微信临时素材的 Buffer。
   */
  async resolveOutboundMediaBuffer(media) {
    const mediaObject = typeof media === 'string' ? { url: media } : (media || {});
    if (Buffer.isBuffer(mediaObject.buffer)) {
      return mediaObject.buffer;
    }

    const url = mediaObject.url || mediaObject.ossUrl || String(media || '');
    if (!url || !this.axiosClient || typeof this.axiosClient.get !== 'function') {
      throw new WecomAibotClientError('WECOM_MEDIA_DOWNLOAD_UNAVAILABLE', 'media buffer or URL is required');
    }

    const response = await this.axiosClient.get(url, {
      responseType: 'arraybuffer',
      timeout: this.config?.media?.downloadTimeoutMs || 10000
    });

    return Buffer.from(response.data || '');
  }

  /**
   * 上传企业微信临时素材。
   * 输入: 媒体类型、媒体对象和兜底文件名。
   * 输出: 企业微信临时 media_id。
   */
  async uploadOutboundMedia(kind, media, fallbackName) {
    if (!this.sdkClient || typeof this.sdkClient.uploadMedia !== 'function') {
      throw new WecomAibotClientError('WECOM_SDK_MEDIA_UPLOAD_FAILED', 'WeCom SDK uploadMedia is unavailable');
    }

    const buffer = await this.resolveOutboundMediaBuffer(media);
    const filename = resolveOutboundMediaFilename(media, fallbackName);
    const result = await this.sdkClient.uploadMedia(buffer, {
      type: kind,
      filename
    });
    const mediaId = result?.media_id || result?.mediaId;

    if (!mediaId) {
      throw new WecomAibotClientError('WECOM_SDK_MEDIA_UPLOAD_FAILED', 'WeCom SDK uploadMedia did not return media_id');
    }

    return mediaId;
  }

  /**
   * 发送企业微信原生媒体。
   * 输入: 标准化消息上下文、媒体类型和临时素材 ID。
   * 输出: SDK 发送结果；缺少发送方法时抛出错误。
   */
  async sendUploadedMedia(message, kind, mediaId) {
    if (typeof this.sdkClient.replyMedia === 'function' && message?.sourceFrame) {
      return this.sdkClient.replyMedia(getStreamSourceFrame(message), kind, mediaId);
    }

    if (typeof this.sdkClient.sendMediaMessage === 'function') {
      const chatId = getSendTarget(message);
      if (chatId) {
        return this.sdkClient.sendMediaMessage(chatId, kind, mediaId);
      }
    }

    throw new WecomAibotClientError('WECOM_SDK_SEND_UNAVAILABLE', 'WeCom SDK media reply API is unavailable');
  }

  /**
   * 发送企业微信图片，必要时降级为文本链接。
   * 输入: 标准化消息上下文和图片 URL/对象。
   * 输出: SDK 发送结果；降级时返回 downgraded=true 和安全错误码。
   */
  async sendImage(message, media) {
    if (!this.sdkClient) {
      throw new WecomAibotClientError('WECOM_SDK_SEND_UNAVAILABLE', 'WeCom SDK sendImage is unavailable');
    }

    let nativeSendError = null;
    try {
      const mediaId = await this.uploadOutboundMedia('image', media, 'image.png');
      return await this.sendUploadedMedia(message, 'image', mediaId);
    } catch (error) {
      if (this.config?.media?.outboundNativeSendFallbackEnabled === false) {
        throw error;
      }
      nativeSendError = error;
    }

    await this.sendText(message, buildMediaLinkText('image', media));
    return {
      downgraded: true,
      errorCode: normalizeNativeMediaErrorCode(nativeSendError?.code)
    };
  }

  /**
   * 发送企业微信文件，必要时降级为文本链接。
   * 输入: 标准化消息上下文和文件 URL/对象。
   * 输出: SDK 发送结果；降级时返回 downgraded=true 和安全错误码。
   */
  async sendFile(message, media) {
    if (!this.sdkClient) {
      throw new WecomAibotClientError('WECOM_SDK_SEND_UNAVAILABLE', 'WeCom SDK sendFile is unavailable');
    }

    let nativeSendError = null;
    try {
      const mediaId = await this.uploadOutboundMedia('file', media, 'file.bin');
      return await this.sendUploadedMedia(message, 'file', mediaId);
    } catch (error) {
      if (this.config?.media?.outboundNativeSendFallbackEnabled === false) {
        throw error;
      }
      nativeSendError = error;
    }

    await this.sendText(message, buildMediaLinkText('file', media));
    return {
      downgraded: true,
      errorCode: normalizeNativeMediaErrorCode(nativeSendError?.code)
    };
  }

  /**
   * 关闭企业微信 SDK 连接并清理事件监听。
   * 输入: 无。
   * 输出: 无返回值；适配不同 SDK 的 close/disconnect 关闭方法。
   */
  async close() {
    const cleanupHandlers = this.cleanupHandlers.splice(0);
    cleanupHandlers.forEach((cleanup) => cleanup());

    if (this.sdkClient && typeof this.sdkClient.close === 'function') {
      await this.sdkClient.close();
    } else if (this.sdkClient && typeof this.sdkClient.disconnect === 'function') {
      this.sdkClient.disconnect();
    }

    this.sdkClient = null;
  }
}

module.exports = {
  WecomAibotClient,
  WecomAibotClientError,
  buildSdkClientOptions,
  createSdkLogger,
  defaultLoadSdk,
  normalizeMessage
};
