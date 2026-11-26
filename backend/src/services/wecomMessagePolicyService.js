const { readWecomBotConfig } = require('../config/wecomBot');
const { normalizeWecomUserId } = require('./wecomUserBindingService');

const SUPPORTED_TEXT_TYPES = new Set(['text', 'markdown', 'template_card_event']);
const SUPPORTED_MEDIA_TYPES = new Set(['image', 'file', 'mixed']);
const RESET_CONVERSATION_COMMAND_TEXT = '重置会话';
const RESET_CONVERSATION_REPLY_TEXT = '会话已重置，下一条消息将开启新的对话';
const DEFAULT_MEDIA_QUESTION = '请分析我发送的图片/文件';
const DEFAULT_QUOTE_QUESTION = '请结合引用内容进行分析。';
const UNSUPPORTED_QUOTE_PLACEHOLDER_TEXT = '[该消息类型暂不能展示]';
const DEFAULT_MAX_MIXED_IMAGE_COUNT = 10;
const DEFAULT_MESSAGE_POLICY_TEXTS = {
  resetConversationCommand: RESET_CONVERSATION_COMMAND_TEXT,
  resetConversationReply: RESET_CONVERSATION_REPLY_TEXT,
  defaultMediaQuestion: DEFAULT_MEDIA_QUESTION,
  groupChatUnsupported: '暂不支持群聊消息',
  emptyMentionText: '请在 @ 机器人后输入问题',
  unsupportedMediaType: '暂不支持该媒体类型，请发送图片或文档文件',
  unsupportedMessageType: '暂不支持该类型消息',
  mediaCountExceeded: '单条消息附件数量超限，请减少后再发送',
  mediaTooLarge: '文件过大，请压缩或拆分后再发送',
  missingUserId: '无法识别发送人，请稍后再试',
  missingExternalUser: '无法识别发送人，请稍后再试',
  textTooLong: '消息太长，请缩短后再发送'
};
const DEFAULT_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const DEFAULT_FILE_EXTENSIONS = ['txt', 'md', 'html', 'htm', 'doc', 'docx', 'pdf', 'ppt', 'pptx', 'csv', 'xls', 'xlsx'];

/**
 * 将任意 ID 转为稳定字符串。
 * 输入: ObjectId、字符串或空值。
 * 输出: 可拼接到会话 Key 中的字符串。
 */
function toIdString(value) {
  if (value && typeof value.toString === 'function') {
    return value.toString();
  }

  return String(value || '');
}

/**
 * 生成不含 raw payload 的消息摘要。
 * 输入: 标准化后的企业微信消息和可选原因。
 * 输出: 仅包含安全元数据的短摘要。
 */
function sanitizeMessageSummary(message = {}, reason = '') {
  return [
    `messageId=${toIdString(message.messageId).slice(0, 80)}`,
    `type=${toIdString(message.messageType || 'unknown').slice(0, 40)}`,
    `chatType=${toIdString(message.chatType || 'unknown').slice(0, 40)}`,
    reason ? `reason=${reason}` : ''
  ].filter(Boolean).join(' ');
}

/**
 * 识别企业微信消息类型。
 * 输入: 标准化消息或 SDK 原始字段。
 * 输出: 小写消息类型；无法识别时返回 unknown。
 */
function getMessageType(message = {}) {
  const rawType = message.messageType || message.msgtype || message.msgType || message.type;
  if (rawType) {
    return String(rawType).toLowerCase();
  }

  return message.text ? 'text' : 'unknown';
}

/**
 * 识别企业微信会话类型。
 * 输入: 标准化消息或 SDK 原始字段。
 * 输出: private、group 或 unknown。
 */
function getChatType(message = {}) {
  const rawType = String(message.chatType || message.chat_type || message.chattype || '').toLowerCase();
  if (rawType === 'private' || rawType === 'single') {
    return 'private';
  }
  if (rawType === 'group' || rawType === 'room') {
    return 'group';
  }

  return rawType || 'unknown';
}

/**
 * 判断文本是否为企业微信会话重置命令。
 * 输入: 已经去除首尾空白的消息文本和可配置命令词。
 * 输出: 完全等于固定命令词时返回 true，否则返回 false。
 */
function isConversationResetCommand(text, commandText = RESET_CONVERSATION_COMMAND_TEXT) {
  return text === commandText;
}

/**
 * 判断群聊 @ 消息是否以独立的会话重置命令结尾。
 * 输入: 标准化消息、已去除可见 @ 的文本和可配置命令词。
 * 输出: 精确命令或“单个 @ 前缀 + 空白 + 末尾命令”结构返回 true。
 */
function isMentionedGroupConversationResetCommand(
  message = {},
  strippedText = '',
  commandText = RESET_CONVERSATION_COMMAND_TEXT
) {
  if (isConversationResetCommand(strippedText, commandText)) {
    return true;
  }

  if (!message.mentionedCurrentBot) {
    return false;
  }

  const rawText = String(message.text || '').trim();
  const command = String(commandText || '');
  if (!command || !rawText.startsWith('@') || !rawText.endsWith(command)) {
    return false;
  }

  const commandStart = rawText.length - command.length;
  if (commandStart <= 1 || !/\s/u.test(rawText.charAt(commandStart - 1))) {
    return false;
  }

  const mentionPrefix = rawText.slice(0, commandStart).trimEnd();
  return mentionPrefix.length > 1 &&
    !/\s/u.test(mentionPrefix.charAt(1)) &&
    !/[\r\n]/u.test(mentionPrefix) &&
    mentionPrefix.indexOf('@', 1) === -1;
}

/**
 * 判断消息是否包含可消费的引用上下文。
 * 输入: 标准化消息。
 * 输出: 有引用文本或引用附件时返回 true。
 */
function hasQuoteContext(message = {}) {
  const quoteText = String(message.quote?.text || '').trim();
  return Boolean(
    (quoteText && quoteText !== UNSUPPORTED_QUOTE_PLACEHOLDER_TEXT) ||
    (Array.isArray(message.quote?.attachments) && message.quote.attachments.length > 0)
  );
}

/**
 * 判断消息是否有显式附件输入。
 * 输入: 消息类型和标准化消息。
 * 输出: 顶层媒体消息或 text 携带附件时返回 true。
 */
function shouldEvaluateMedia(messageType, message = {}) {
  return SUPPORTED_MEDIA_TYPES.has(messageType) ||
    (Array.isArray(message.attachments) && message.attachments.length > 0);
}

/**
 * 统计引用附件类型。
 * 输入: 已净化附件数组。
 * 输出: 图片和文件数量。
 */
function countQuoteAttachments(attachments = []) {
  return attachments.reduce((counts, attachment) => {
    const kind = String(attachment.kind || '').toLowerCase();
    if (kind === 'image') counts.image += 1;
    if (kind === 'file') counts.file += 1;
    return counts;
  }, { image: 0, file: 0 });
}

/**
 * 生成引用附件说明。
 * 输入: 已净化附件数组。
 * 输出: 不包含 URL、媒体 ID 或 aesKey 的中文说明。
 */
function buildQuoteAttachmentDescription(attachments = []) {
  const counts = countQuoteAttachments(attachments);
  const parts = [];
  if (counts.image) parts.push(`${counts.image} 张图片`);
  if (counts.file) parts.push(`${counts.file} 个文件`);
  if (!parts.length) return '';
  const nouns = [];
  if (counts.image) nouns.push('图片');
  if (counts.file) nouns.push('文件');
  return `引用附件：用户引用了 ${parts.join('和')}，${nouns.join('和')}已作为附件提供，请结合附件内容回答。`;
}

/**
 * 生成引用文件展示名文本。
 * 输入: 已净化附件数组。
 * 输出: 文件展示名行；本期不做截断或清洗。
 */
function buildQuoteFilenameText(attachments = []) {
  const names = attachments
    .filter((attachment) => String(attachment.kind || '').toLowerCase() === 'file')
    .map((attachment) => String(attachment.name || '').trim())
    .filter(Boolean);
  return names.length ? `引用文件：${names.join('、')}` : '';
}

/**
 * 构造传给 FastGPT 的引用上下文文本。
 * 输入: 主问题、标准化消息、净化附件和默认问题。
 * 输出: 包含用户问题和引用上下文的可读文本。
 */
function buildTextWithQuoteContext({ questionText, message, attachments, fallbackQuestion }) {
  if (!hasQuoteContext(message)) {
    return questionText;
  }

  const finalQuestion = String(questionText || '').trim() || fallbackQuestion || DEFAULT_QUOTE_QUESTION;
  const quoteText = String(message.quote?.text || '').trim();
  const safeQuoteText = quoteText === UNSUPPORTED_QUOTE_PLACEHOLDER_TEXT ? '' : quoteText;
  const filenameText = buildQuoteFilenameText(attachments);
  const attachmentText = buildQuoteAttachmentDescription(attachments);
  const quoteLines = ['引用消息上下文：'];

  if (safeQuoteText) {
    quoteLines.push('引用文本：');
    quoteLines.push(safeQuoteText);
  }
  if (filenameText) quoteLines.push(filenameText);
  if (attachmentText) quoteLines.push(attachmentText);

  return ['用户问题：', finalQuestion, '', ...quoteLines].join('\n');
}

/**
 * 判断附件数量是否使用 mixed 图片上限。
 * 输入: 消息类型、标准化消息和净化附件。
 * 输出: 顶层 mixed 或引用 mixed 且至少包含附件时返回 true。
 */
function shouldUseMixedImageLimit(messageType, message = {}, attachments = []) {
  const quoteType = String(message.quote?.messageType || '').toLowerCase();
  return (messageType === 'mixed' || quoteType === 'mixed') && attachments.length > 0;
}

/**
 * 判断顶层 mixed 的附件是否违反仅支持图片规则。
 * 输入: 顶层消息类型和已净化附件。
 * 输出: 顶层 mixed 中来源不是 quote 且类型不是 image 时返回 true。
 */
function isUnsupportedTopLevelMixedAttachment(messageType, attachment = {}) {
  return messageType === 'mixed' &&
    String(attachment.source || 'message').toLowerCase() !== 'quote' &&
    String(attachment.kind || '').toLowerCase() !== 'image';
}

/**
 * 按聊天类型生成 FastGPT 会话隔离键。
 * 输入: 绑定 ID、聊天类型、群聊 ID 和外部联系人 ID。
 * 输出: 稳定的 conversationKey 字符串。
 */
function buildConversationKey({ bindingId, chatType, chatId, externalUserId }) {
  if (chatType === 'group') {
    return `wecom:group:${bindingId}:${chatId}:${externalUserId}`;
  }

  return `wecom:private:${bindingId}:${externalUserId}`;
}

/**
 * 为群聊 @ 消息取实际提问文本。
 * 输入: 已归一化的企业微信消息。
 * 输出: 去除机器人 @ 后的清理文本。
 */
function getGroupQuestionText(message = {}) {
  return String(message.textWithoutBotMention ?? '').trim();
}

/**
 * 解析消息策略的用户可见文案配置。
 * 输入: 企业微信 Bot 配置对象。
 * 输出: 合并默认值后的策略文案对象。
 */
function resolveMessagePolicyTexts(config = {}) {
  const configuredTexts = config?.message?.texts || {};
  return Object.fromEntries(Object.entries(DEFAULT_MESSAGE_POLICY_TEXTS).map(([key, fallback]) => [
    key,
    configuredTexts[key] === undefined || configuredTexts[key] === null || configuredTexts[key] === ''
      ? fallback
      : String(configuredTexts[key])
  ]));
}

/**
 * 读取媒体扩展名。
 * 输入: 文件名字符串。
 * 输出: 不带点的小写扩展名。
 */
function getExtension(name = '') {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

/**
 * 判断附件是否具备后续下载识别所需的入口。
 * 输入: 标准化后的附件对象。
 * 输出: 有 URL、企微媒体 ID 或 SDK 兼容下载字段时返回 true。
 */
function hasResolvableDownloadData(attachment = {}) {
  return Boolean(
    attachment.downloadUrl ||
    attachment.url ||
    attachment.wecomMediaId ||
    attachment.mediaId ||
    attachment.media_id
  );
}

/**
 * 判断单个媒体附件是否为支持类型。
 * 输入: 附件对象、消息类型和允许的扩展名配置。
 * 输出: 支持时返回 true，否则返回 false。
 */
function isSupportedMediaAttachment(attachment = {}, messageType, mediaConfig = {}) {
  const kind = String(attachment.kind || messageType || '').toLowerCase();
  const extension = getExtension(attachment.name || attachment.filename || attachment.originalName || '');
  const mimeType = String(attachment.mimeType || attachment.mimetype || '').toLowerCase();
  const imageExtensions = mediaConfig.allowedImageExtensions || DEFAULT_IMAGE_EXTENSIONS;
  const fileExtensions = mediaConfig.allowedFileExtensions || DEFAULT_FILE_EXTENSIONS;

  if (kind === 'image') {
    if (imageExtensions.includes(extension) || mimeType.startsWith('image/')) {
      return true;
    }

    return !extension && !mimeType && hasResolvableDownloadData(attachment);
  }

  if (kind === 'file') {
    if (fileExtensions.includes(extension) ||
      /pdf|word|excel|spreadsheet|presentation|powerpoint|csv|text|markdown|html/.test(mimeType)) {
      return true;
    }

    return !extension && !mimeType && hasResolvableDownloadData(attachment);
  }

  return false;
}

/**
 * 获取媒体附件列表并清理可枚举敏感字段。
 * 输入: 标准化消息和消息类型。
 * 输出: 不会被 JSON.stringify 暴露媒体 ID 和 aesKey 的附件数组。
 */
function getSanitizedAttachments(message = {}, messageType = '') {
  const rawAttachments = Array.isArray(message.attachments) ? message.attachments : [];
  const inferredAttachment = (!rawAttachments.length && (message.mediaId || message.wecomMediaId))
    ? [{
        kind: messageType,
        name: message.filename ||
          message.fileName ||
          message.name ||
          (messageType === 'image' ? 'image.jpg' : 'file.pdf'),
        mimeType: message.mimeType || message.mimetype || '',
        size: Number(message.size || 0),
        wecomMediaId: message.mediaId || message.wecomMediaId,
        aesKey: message.aesKey || message.aeskey || message.aes_key,
        downloadUrl: message.downloadUrl || ''
      }]
    : null;
  const attachments = inferredAttachment || rawAttachments;

  return attachments.map((attachment) => {
    const sanitized = {
      kind: String(attachment.kind || messageType || '').toLowerCase(),
      source: attachment.source || 'message',
      name: attachment.name || attachment.filename || attachment.originalName || '',
      mimeType: attachment.mimeType || attachment.mimetype || '',
      size: Number(attachment.size || 0),
      downloadUrl: attachment.downloadUrl || attachment.url || ''
    };
    const mediaId = attachment.wecomMediaId || attachment.mediaId || attachment.media_id || '';
    if (mediaId) {
      Object.defineProperty(sanitized, 'wecomMediaId', {
        value: mediaId,
        enumerable: false,
        configurable: true
      });
    }
    const aesKey = attachment.aesKey || attachment.aeskey || attachment.aes_key || '';
    if (aesKey) {
      Object.defineProperty(sanitized, 'aesKey', {
        value: aesKey,
        enumerable: false,
        configurable: true
      });
    }
    return sanitized;
  });
}

/**
 * 获取引用附件列表并清理可枚举敏感字段。
 * 输入: 标准化消息和消息类型。
 * 输出: 来自 quote 的安全附件数组。
 */
function getSanitizedQuoteAttachments(message = {}, messageType = '') {
  const rawAttachments = Array.isArray(message.quote?.attachments) ? message.quote.attachments : [];

  return rawAttachments.map((attachment) => {
    const sanitized = {
      kind: String(attachment.kind || messageType || '').toLowerCase(),
      source: attachment.source || 'quote',
      name: attachment.name || attachment.filename || attachment.originalName || '',
      mimeType: attachment.mimeType || attachment.mimetype || '',
      size: Number(attachment.size || 0),
      downloadUrl: attachment.downloadUrl || attachment.url || ''
    };
    const mediaId = attachment.wecomMediaId || attachment.mediaId || attachment.media_id || '';
    if (mediaId) {
      Object.defineProperty(sanitized, 'wecomMediaId', {
        value: mediaId,
        enumerable: false,
        configurable: true
      });
    }
    const aesKey = attachment.aesKey || attachment.aeskey || attachment.aes_key || '';
    if (aesKey) {
      Object.defineProperty(sanitized, 'aesKey', {
        value: aesKey,
        enumerable: false,
        configurable: true
      });
    }
    return sanitized;
  });
}

/**
 * 合并主消息附件与引用附件并去重。
 * 输入: 主消息附件和引用附件，均应为已净化对象数组。
 * 输出: 保留顺序的去重后附件数组。
 */
function mergeSanitizedAttachments(primaryAttachments = [], quoteAttachments = []) {
  const merged = [];
  const seen = new Set();

  const buildAttachmentKey = (attachment = {}) => {
    const downloadUrl = String(attachment.downloadUrl || '').trim();
    if (downloadUrl) {
      return `downloadUrl:${downloadUrl}`;
    }

    return [
      String(attachment.source || '').trim(),
      String(attachment.kind || '').trim(),
      String(attachment.name || '').trim(),
      String(attachment.mimeType || '').trim()
    ].join('|');
  };

  for (const attachment of [...primaryAttachments, ...quoteAttachments]) {
    const key = buildAttachmentKey(attachment);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(attachment);
  }

  return merged;
}

/**
 * 创建企业微信消息策略服务。
 * 输入: 企业微信 Bot 配置，包含文本、媒体和 mixed 多图限制。
 * 输出: 可评估消息是否转发、忽略或回复友好提示的服务对象。
 */
function createWecomMessagePolicyService({ config = readWecomBotConfig() } = {}) {
  const maxInboundTextLength = config?.message?.maxInboundTextLength || 4000;
  const textConfig = resolveMessagePolicyTexts(config);
  const mediaConfig = {
    maxInboundMediaCount: config?.message?.maxInboundMediaCount || config?.media?.maxInboundMediaCount || 1,
    maxInboundMixedImageCount: config?.message?.maxInboundMixedImageCount ||
      config?.media?.maxInboundMixedImageCount ||
      DEFAULT_MAX_MIXED_IMAGE_COUNT,
    maxInboundMediaBytes: config?.message?.maxInboundMediaBytes || config?.media?.maxInboundMediaBytes || (5 * 1024 * 1024),
    allowedImageExtensions: config?.media?.allowedImageExtensions || DEFAULT_IMAGE_EXTENSIONS,
    allowedFileExtensions: config?.media?.allowedFileExtensions || DEFAULT_FILE_EXTENSIONS
  };

  /**
   * 评估单条入站消息。
   * 输入: Bot 绑定配置和标准化消息。
   * 输出: 不含 raw payload 的策略决策。
   */
  function evaluate({ binding = {}, message = {} } = {}) {
    const messageType = getMessageType(message);
    const chatType = getChatType(message);
    const text = String(message.text || '').trim();
    const bindingId = toIdString(binding._id || binding.id || binding.bindingId);
    const externalUserId = normalizeWecomUserId(toIdString(message.externalUserId || message.userId));
    const chatId = toIdString(message.chatId || message.roomId || message.groupId);
    const messageId = toIdString(message.messageId || message.id);

    if (chatType === 'group') {
      if (binding.groupChatMentionEnabled === false) {
        return {
          action: 'ignore',
          forwardToFastgpt: false,
          reason: 'GROUP_CHAT_MENTION_DISABLED',
          chatId,
          externalUserId,
          messageType,
          chatType,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'GROUP_CHAT_MENTION_DISABLED')
        };
      }

      if (!message.mentionedCurrentBot) {
        return {
          action: 'ignore',
          forwardToFastgpt: false,
          reason: 'GROUP_CHAT_BOT_NOT_MENTIONED',
          chatId,
          externalUserId,
          messageType,
          chatType,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'GROUP_CHAT_BOT_NOT_MENTIONED')
        };
      }

      if (!chatId) {
        return {
          action: 'reject',
          forwardToFastgpt: false,
          reason: 'MISSING_GROUP_CHAT_ID',
          replyText: textConfig.missingUserId,
          chatId,
          externalUserId,
          messageType,
          chatType,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'MISSING_GROUP_CHAT_ID')
        };
      }

      if (!externalUserId) {
        return {
          action: 'reject',
          forwardToFastgpt: false,
          reason: 'MISSING_EXTERNAL_USER_ID',
          replyText: textConfig.missingUserId,
          chatId,
          externalUserId,
          messageType,
          chatType,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'MISSING_EXTERNAL_USER_ID')
        };
      }

      if (!SUPPORTED_TEXT_TYPES.has(messageType) && !SUPPORTED_MEDIA_TYPES.has(messageType)) {
        return {
          action: 'unsupported',
          forwardToFastgpt: false,
          reason: 'UNSUPPORTED_MEDIA_TYPE',
          replyText: textConfig.unsupportedMediaType,
          chatId,
          externalUserId,
          messageType,
          chatType,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'UNSUPPORTED_MEDIA_TYPE')
        };
      }

      const hasMediaInput = shouldEvaluateMedia(messageType, message);
      const primaryAttachments = hasMediaInput ? getSanitizedAttachments(message, messageType) : [];
      const quoteAttachments = getSanitizedQuoteAttachments(message, messageType);
      const attachments = mergeSanitizedAttachments(primaryAttachments, quoteAttachments);
      if (SUPPORTED_MEDIA_TYPES.has(messageType) && !attachments.length && messageType !== 'mixed') {
        return {
          action: 'unsupported',
          forwardToFastgpt: false,
          reason: 'UNSUPPORTED_MESSAGE_TYPE',
          replyText: textConfig.unsupportedMessageType,
          chatId,
          externalUserId,
          messageType,
          chatType,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'UNSUPPORTED_MESSAGE_TYPE')
        };
      }

      if (attachments.length) {
        const useMixedLimit = shouldUseMixedImageLimit(messageType, message, attachments);
        const attachmentCount = useMixedLimit
          ? attachments.filter((attachment) => attachment.kind === 'image').length
          : attachments.length;
        const maxAttachmentCount = useMixedLimit
          ? mediaConfig.maxInboundMixedImageCount
          : mediaConfig.maxInboundMediaCount;
        if (attachmentCount > maxAttachmentCount) {
          return {
            action: 'reject',
            forwardToFastgpt: false,
            reason: 'MEDIA_COUNT_EXCEEDED',
            replyText: textConfig.mediaCountExceeded,
            chatId,
            externalUserId,
            messageType,
            chatType,
            summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'MEDIA_COUNT_EXCEEDED')
          };
        }

        const oversized = attachments.find((attachment) => Number(attachment.size || 0) > mediaConfig.maxInboundMediaBytes);
        if (oversized) {
          return {
            action: 'reject',
            forwardToFastgpt: false,
            reason: 'MEDIA_TOO_LARGE',
            replyText: textConfig.mediaTooLarge,
            chatId,
            externalUserId,
            messageType,
            chatType,
            summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'MEDIA_TOO_LARGE')
          };
        }

        const unsupported = attachments.find((attachment) => (
          isUnsupportedTopLevelMixedAttachment(messageType, attachment) ||
          !isSupportedMediaAttachment(attachment, attachment.kind || messageType, mediaConfig)
        ));
        if (unsupported) {
          return {
            action: 'unsupported',
            forwardToFastgpt: false,
            reason: 'UNSUPPORTED_MEDIA_TYPE',
            replyText: textConfig.unsupportedMediaType,
            chatId,
            externalUserId,
            messageType,
            chatType,
            summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'UNSUPPORTED_MEDIA_TYPE')
          };
        }
      }

      const groupText = getGroupQuestionText(message);
      const fallbackQuestion = hasQuoteContext(message)
        ? DEFAULT_QUOTE_QUESTION
        : textConfig.defaultMediaQuestion;
      const baseTextForFastgpt = groupText || (attachments.length > 0 || hasQuoteContext(message) ? fallbackQuestion : '');
      const textForFastgpt = buildTextWithQuoteContext({
        questionText: baseTextForFastgpt,
        message,
        attachments,
        fallbackQuestion
      });

      if (!attachments.length && isMentionedGroupConversationResetCommand(
        message,
        groupText,
        textConfig.resetConversationCommand
      )) {
        return {
          action: 'reset_conversation',
          forwardToFastgpt: false,
          reason: 'RESET_CONVERSATION_COMMAND',
          messageId,
          text: textConfig.resetConversationCommand,
          chatId,
          externalUserId,
          chatType,
          messageType,
          conversationKey: buildConversationKey({ bindingId, chatType, chatId, externalUserId }),
          replyText: textConfig.resetConversationReply,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'RESET_CONVERSATION_COMMAND')
        };
      }

      if (!textForFastgpt) {
        return {
          action: 'reject',
          forwardToFastgpt: false,
          reason: 'EMPTY_GROUP_MENTION_TEXT',
          replyText: textConfig.emptyMentionText,
          chatId,
          externalUserId,
          messageType,
          chatType,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'EMPTY_GROUP_MENTION_TEXT')
        };
      }

      if (textForFastgpt.length > maxInboundTextLength) {
        return {
          action: 'reject',
          forwardToFastgpt: false,
          reason: 'TEXT_TOO_LONG',
          replyText: textConfig.textTooLong,
          chatId,
          externalUserId,
          messageType,
          chatType,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'TEXT_TOO_LONG')
        };
      }

      return {
        action: 'forward',
        forwardToFastgpt: true,
        reason: 'GROUP_CHAT_MENTIONED',
        messageId,
        text: textForFastgpt,
        chatId,
        externalUserId,
        chatType,
        messageType,
        conversationKey: buildConversationKey({ bindingId, chatType, chatId, externalUserId }),
        attachments,
        summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'GROUP_CHAT_MENTIONED')
      };
    }

    if (chatType !== 'private') {
      return {
        action: 'ignore',
        forwardToFastgpt: false,
        reason: 'UNKNOWN_CHAT_TYPE',
        summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'UNKNOWN_CHAT_TYPE')
      };
    }

    if ((binding.privateChatPolicy || 'reply_all') === 'disabled') {
      return {
        action: 'ignore',
        forwardToFastgpt: false,
        reason: 'PRIVATE_CHAT_DISABLED',
        summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'PRIVATE_CHAT_DISABLED')
      };
    }

    if (!SUPPORTED_TEXT_TYPES.has(messageType) && !SUPPORTED_MEDIA_TYPES.has(messageType)) {
      return {
        action: 'unsupported',
        forwardToFastgpt: false,
        reason: 'UNSUPPORTED_MEDIA_TYPE',
        replyText: textConfig.unsupportedMediaType,
        summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'UNSUPPORTED_MEDIA_TYPE')
      };
    }

    const quoteAttachments = getSanitizedQuoteAttachments(message, messageType);
    const hasMediaInput = shouldEvaluateMedia(messageType, message);

    if (hasMediaInput) {
      const primaryAttachments = getSanitizedAttachments(message, messageType);
      const attachments = mergeSanitizedAttachments(primaryAttachments, quoteAttachments);
      if (!attachments.length && messageType !== 'mixed') {
        return {
          action: 'unsupported',
          forwardToFastgpt: false,
          reason: 'UNSUPPORTED_MESSAGE_TYPE',
          replyText: textConfig.unsupportedMessageType,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'UNSUPPORTED_MESSAGE_TYPE')
        };
      }

      if (attachments.length) {
        const useMixedLimit = shouldUseMixedImageLimit(messageType, message, attachments);
        const attachmentCount = useMixedLimit
          ? attachments.filter((attachment) => attachment.kind === 'image').length
          : attachments.length;
        const maxAttachmentCount = useMixedLimit
          ? mediaConfig.maxInboundMixedImageCount
          : mediaConfig.maxInboundMediaCount;
        if (attachmentCount > maxAttachmentCount) {
          return {
            action: 'reject',
            forwardToFastgpt: false,
            reason: 'MEDIA_COUNT_EXCEEDED',
            replyText: textConfig.mediaCountExceeded,
            summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'MEDIA_COUNT_EXCEEDED')
          };
        }

        const oversized = attachments.find((attachment) => Number(attachment.size || 0) > mediaConfig.maxInboundMediaBytes);
        if (oversized) {
          return {
            action: 'reject',
            forwardToFastgpt: false,
            reason: 'MEDIA_TOO_LARGE',
            replyText: textConfig.mediaTooLarge,
            summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'MEDIA_TOO_LARGE')
          };
        }

        const unsupported = attachments.find((attachment) => (
          isUnsupportedTopLevelMixedAttachment(messageType, attachment) ||
          !isSupportedMediaAttachment(attachment, attachment.kind || messageType, mediaConfig)
        ));
        if (unsupported) {
          return {
            action: 'unsupported',
            forwardToFastgpt: false,
            reason: 'UNSUPPORTED_MEDIA_TYPE',
            replyText: textConfig.unsupportedMediaType,
            summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'UNSUPPORTED_MEDIA_TYPE')
          };
        }

        if (!externalUserId) {
          return {
            action: 'reject',
            forwardToFastgpt: false,
            reason: 'MISSING_EXTERNAL_USER_ID',
            replyText: textConfig.missingExternalUser,
            summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'MISSING_EXTERNAL_USER_ID')
          };
        }

        const mediaFallbackQuestion = hasQuoteContext(message)
          ? DEFAULT_QUOTE_QUESTION
          : textConfig.defaultMediaQuestion;
        const mediaTextForFastgpt = buildTextWithQuoteContext({
          questionText: text || mediaFallbackQuestion,
          message,
          attachments,
          fallbackQuestion: mediaFallbackQuestion
        });

        if (mediaTextForFastgpt.length > maxInboundTextLength) {
          return {
            action: 'reject',
            forwardToFastgpt: false,
            reason: 'TEXT_TOO_LONG',
            replyText: textConfig.textTooLong,
            summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'TEXT_TOO_LONG')
          };
        }

        return {
          action: 'forward',
          forwardToFastgpt: true,
          messageId,
          text: mediaTextForFastgpt,
          externalUserId,
          conversationKey: buildConversationKey({
            bindingId,
            chatType: 'private',
            chatId: '',
            externalUserId
          }),
          attachments,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'FORWARD_MEDIA')
        };
      }
    }

    if (!text && hasQuoteContext(message)) {
      if (!externalUserId) {
        return {
          action: 'reject',
          forwardToFastgpt: false,
          reason: 'MISSING_EXTERNAL_USER_ID',
          replyText: textConfig.missingExternalUser,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'MISSING_EXTERNAL_USER_ID')
        };
      }

      const quoteTextForFastgpt = buildTextWithQuoteContext({
        questionText: DEFAULT_QUOTE_QUESTION,
        message,
        attachments: quoteAttachments,
        fallbackQuestion: DEFAULT_QUOTE_QUESTION
      });
      if (quoteTextForFastgpt.length > maxInboundTextLength) {
        return {
          action: 'reject',
          forwardToFastgpt: false,
          reason: 'TEXT_TOO_LONG',
          replyText: textConfig.textTooLong,
          summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'TEXT_TOO_LONG')
        };
      }
      return {
        action: 'forward',
        forwardToFastgpt: true,
        messageId,
        text: quoteTextForFastgpt,
        externalUserId,
        conversationKey: buildConversationKey({
          bindingId,
          chatType: 'private',
          chatId: '',
          externalUserId
        }),
        attachments: quoteAttachments,
        summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'FORWARD_QUOTE_TEXT')
      };
    }

    if (!text) {
      return {
        action: 'ignore',
        forwardToFastgpt: false,
        reason: 'EMPTY_TEXT',
        summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'EMPTY_TEXT')
      };
    }

    if (!externalUserId) {
      return {
        action: 'reject',
        forwardToFastgpt: false,
        reason: 'MISSING_EXTERNAL_USER_ID',
        replyText: textConfig.missingExternalUser,
        summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'MISSING_EXTERNAL_USER_ID')
      };
    }

    if (isConversationResetCommand(text, textConfig.resetConversationCommand)) {
      return {
        action: 'reset_conversation',
        forwardToFastgpt: false,
        reason: 'RESET_CONVERSATION_COMMAND',
        messageId,
        text,
        externalUserId,
        conversationKey: buildConversationKey({
          bindingId,
          chatType: 'private',
          chatId: '',
          externalUserId
        }),
        replyText: textConfig.resetConversationReply,
        summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'RESET_CONVERSATION_COMMAND')
      };
    }

    const privateTextForFastgpt = buildTextWithQuoteContext({
      questionText: text,
      message,
      attachments: quoteAttachments,
      fallbackQuestion: DEFAULT_QUOTE_QUESTION
    });

    if (privateTextForFastgpt.length > maxInboundTextLength) {
      return {
        action: 'reject',
        forwardToFastgpt: false,
        reason: 'TEXT_TOO_LONG',
        replyText: textConfig.textTooLong,
        summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'TEXT_TOO_LONG')
      };
    }

    return {
      action: 'forward',
      forwardToFastgpt: true,
      messageId,
      text: privateTextForFastgpt,
      externalUserId,
      conversationKey: buildConversationKey({
        bindingId,
        chatType: 'private',
        chatId: '',
        externalUserId
      }),
      ...(quoteAttachments.length ? { attachments: quoteAttachments } : {}),
      summary: sanitizeMessageSummary({ ...message, messageType, chatType, messageId }, 'FORWARD')
    };
  }

  return { evaluate };
}

module.exports = {
  createWecomMessagePolicyService,
  sanitizeMessageSummary
};
