const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { wecomBotConfig } = require('../config/wecomBot');
const WecomBotMediaAsset = require('../models/WecomBotMediaAsset');
const appLogger = require('../utils/logger');

/**
 * 企业微信媒体存储服务错误。
 * 输入: 业务错误码、错误消息和可选底层原因/上传响应码。
 * 输出: 带 code/cause/responseCode 的 Error 实例。
 */
class WecomMediaStorageServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'WecomMediaStorageServiceError';
    this.code = code;
    this.cause = options.cause;
    this.responseCode = options.responseCode;
  }
}

/**
 * 读取当前时间。
 * 输入: 无。
 * 输出: Date 实例。
 */
function defaultNow() {
  return new Date();
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
 * 记录结构化日志。
 * 输入: logger、级别、消息和安全元数据。
 * 输出: 无；logger 不可用时静默跳过。
 */
function writeStructuredLog(logger, level, message, meta = {}) {
  const log = logger?.[level] || logger?.info || logger?.log;
  if (typeof log === 'function') {
    log.call(logger, message, meta);
  }
}

/**
 * 将任意值转为字符串。
 * 输入: 任意值。
 * 输出: 安全字符串。
 */
function toSafeString(value) {
  if (value && typeof value.toString === 'function') {
    return value.toString();
  }

  return String(value || '');
}

/**
 * 计算 SHA-256 哈希。
 * 输入: Buffer 或字符串。
 * 输出: sha256: 前缀的十六进制哈希；空值返回空字符串。
 */
function createHashValue(value) {
  if (!value) {
    return '';
  }

  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

/**
 * 脱敏 URL 和敏感 token。
 * 输入: 任意错误或文本。
 * 输出: 不含完整 URL、token、Secret、媒体 ID 的摘要。
 */
function sanitizeMediaSummary(value) {
  return String(value?.message || value || 'media storage error')
    .replace(/https?:\/\/\S+/gi, '[URL_REDACTED]')
    .replace(/(api[_-]?key|secret|token)=\S+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/MEDIA[_-]?[A-Z0-9_:-]+/gi, '[MEDIA_ID_REDACTED]')
    .replace(/raw payload/gi, 'payload')
    .slice(0, 500);
}

/**
 * 提取 URL 主机名。
 * 输入: URL 字符串。
 * 输出: 小写 host；解析失败返回空字符串。
 */
function getUrlHost(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch (error) {
    return '';
  }
}

/**
 * 生成补零日期片段。
 * 输入: Date 实例。
 * 输出: yyyy、MM、dd 字符串。
 */
function getDateParts(date) {
  return {
    yyyy: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    dd: String(date.getDate()).padStart(2, '0')
  };
}

/**
 * 生成 media storage 文件夹名。
 * 输入: appId、direction 和日期。
 * 输出: AgentPlaza/fastgpt/.../ 形式路径。
 */
function buildFolderName({ appId, direction, date }) {
  const { yyyy, MM, dd } = getDateParts(date);
  return `AgentPlaza/fastgpt/${toSafeString(appId)}/${yyyy}/${MM}/${dd}/${direction}/`;
}

/**
 * 清理文件名中的危险字符。
 * 输入: 原始文件名。
 * 输出: 可放入 OSS 对象路径的文件名。
 */
function sanitizeFileName(originalName = '') {
  const baseName = path.basename(toSafeString(originalName) || 'media.bin');
  const safe = baseName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_').replace(/_+/g, '_');
  return safe || 'media.bin';
}

/**
 * 提取文件扩展名。
 * 输入: 文件名或 MIME 兜底。
 * 输出: 不带点的小写扩展名。
 */
function getExtension(fileName = '') {
  return path.extname(fileName).replace(/^\./, '').toLowerCase();
}

/**
 * 提取 URL 路径中的扩展名。
 * 输入: 完整 URL 或路径字符串。
 * 输出: 不带点的小写扩展名；解析失败时回退到普通文件名解析。
 */
function getUrlExtension(url = '') {
  try {
    return getExtension(new URL(toSafeString(url)).pathname);
  } catch (error) {
    return getExtension(url);
  }
}

/**
 * 生成安全的 OSS URL 诊断字段。
 * 输入: 完整 OSS URL。
 * 输出: 不含路径和查询参数的存在性、协议、域名、长度和扩展名。
 */
function buildOssUrlDiagnostics(url = '') {
  const raw = toSafeString(url);
  const base = {
    ossUrl: raw,
    ossUrlPresent: Boolean(raw),
    ossUrlLength: raw.length,
    ossUrlExtension: getUrlExtension(raw)
  };

  try {
    const parsed = new URL(raw);
    return {
      ...base,
      ossUrlProtocol: parsed.protocol,
      ossUrlHost: parsed.host.toLowerCase()
    };
  } catch (error) {
    return {
      ...base,
      ossUrlProtocol: '',
      ossUrlHost: ''
    };
  }
}

/**
 * 从上传接口响应中读取 URL。
 * 输入: media storage 上传响应数据。
 * 输出: URL 字符串；缺失时返回空字符串。
 */
function getUploadResponseUrl(data = {}) {
  return toSafeString(data.url || data.data?.url || data.result?.url || data.fileUrl || data.location);
}

/**
 * 标准化 media storage URL。
 * 输入: 上传接口返回 URL、允许主机、公开域名和可信上传响应主机。
 * 输出: HTTPS URL；非法域名或协议抛出业务错误。
 */
function normalizeUploadUrl(url, allowedHosts = [], { publicBaseUrl = '', trustedSourceHosts = [] } = {}) {
  const rawUrl = toSafeString(url);
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new WecomMediaStorageServiceError('MEDIA_STORAGE_URL_INVALID', 'media storage returned an invalid media URL', {
      cause: error
    });
  }

  const host = parsed.host.toLowerCase();
  const normalizedAllowedHosts = allowedHosts.map((item) => String(item).toLowerCase());
  if (!normalizedAllowedHosts.includes(host)) {
    const normalizedTrustedHosts = trustedSourceHosts.map((item) => String(item).toLowerCase()).filter(Boolean);
    if (!publicBaseUrl || !normalizedTrustedHosts.includes(host)) {
      throw new WecomMediaStorageServiceError('MEDIA_STORAGE_DOMAIN_REJECTED', 'media storage returned an untrusted domain');
    }

    try {
      const publicBase = new URL(publicBaseUrl);
      parsed.protocol = publicBase.protocol;
      parsed.host = publicBase.host;
    } catch (error) {
      throw new WecomMediaStorageServiceError('MEDIA_STORAGE_URL_INVALID', 'media storage public base URL is invalid', {
        cause: error
      });
    }
  }

  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || !normalizedAllowedHosts.includes(parsed.host.toLowerCase())) {
    throw new WecomMediaStorageServiceError('MEDIA_STORAGE_PROTOCOL_REJECTED', 'media storage media URL must use HTTPS');
  }

  return parsed.toString();
}

/**
 * 解析 OSS 对象 Key。
 * 输入: 完整 OSS URL、bucketName 和预期 folderName/fileName。
 * 输出: 不含 bucket 的对象 Key。
 */
function resolveObjectKey({ ossUrl, bucketName, folderName, fileName }) {
  try {
    const parsed = new URL(ossUrl);
    const prefix = `/${bucketName}/`;
    if (parsed.pathname.startsWith(prefix)) {
      return decodeURIComponent(parsed.pathname.slice(prefix.length));
    }
  } catch (error) {
    // ignore and use deterministic fallback
  }

  return `${folderName}${fileName}`;
}

/**
 * 校验 URL 响应是否可被 FastGPT 读取。
 * 输入: axios 客户端、URL、超时毫秒和期望媒体类型。
 * 输出: 校验通过时返回 true；不可达或 HTML 登录页时抛出业务错误。
 */
/**
 * 校验 URL 是否可访问并返回可记录的访问摘要。
 * 输入: axios 客户端、URL 和超时毫秒数。
 * 输出: HEAD 校验方法、状态码、content-type 和 verified 标记。
 */
async function verifyAccessibleUrl({ axiosClient, url, timeoutMs }) {
  if (!axiosClient || typeof axiosClient.head !== 'function') {
    return {
      method: 'SKIPPED',
      verified: false,
      status: 0,
      contentType: ''
    };
  }

  try {
    const response = await axiosClient.head(url, { timeout: timeoutMs });
    const contentType = String(response?.headers?.['content-type'] || response?.headers?.['Content-Type'] || '').toLowerCase();
    const status = Number(response?.status || 0);
    if (status >= 400 || contentType.includes('text/html')) {
      throw new WecomMediaStorageServiceError('MEDIA_STORAGE_URL_UNREACHABLE', 'media storage media URL returned an HTML page');
    }
    return {
      method: 'HEAD',
      verified: true,
      status,
      contentType
    };
  } catch (error) {
    if (error instanceof WecomMediaStorageServiceError) {
      throw error;
    }
    throw new WecomMediaStorageServiceError('MEDIA_STORAGE_URL_UNREACHABLE', 'media storage media URL is not reachable', {
      cause: error
    });
  }
}

/**
 * 企业微信媒体存储服务。
 * 输入: HTTP 客户端、FormData 类、媒体配置和可选模型。
 * 输出: 提供 media storage 上传和 URL 校验能力的服务实例。
 */
class WecomMediaStorageService {
  constructor({
    config = wecomBotConfig.media,
    axiosClient = axios,
    FormDataClass = FormData,
    MediaAssetModel = null,
    logger = defaultLogger(),
    now = defaultNow
  } = {}) {
    this.config = config || {};
    this.axiosClient = axiosClient;
    this.FormDataClass = FormDataClass;
    this.MediaAssetModel = MediaAssetModel;
    this.logger = logger;
    this.now = now;
  }

  /**
   * 上传媒体到 media storage。
   * 输入: appId、方向、媒体类型、文件 Buffer 和诊断元数据。
   * 输出: OSS URL、hash、对象 Key 和可传给 FastGPT 的媒体信息。
   */
  async uploadMedia({
    appId,
    binding,
    bindingId,
    messageId,
    direction = 'inbound',
    kind,
    messageType,
    index = 0,
    originalName,
    filename,
    mimeType = '',
    size,
    buffer,
    source = 'wecom',
    externalUserId = '',
    conversationKey = '',
    wecomMediaId = ''
  } = {}) {
    const mediaKind = kind || messageType;
    const resolvedAppId = toSafeString(appId || binding?.appId);
    const resolvedBindingId = toSafeString(bindingId || binding?._id || binding?.id || binding?.bindingId);
    const date = this.now();
    if (!this.config.uploadUrl || !this.config.allowedHosts?.length) {
      throw new WecomMediaStorageServiceError('MEDIA_STORAGE_UNAVAILABLE', 'WeCom media storage is not configured');
    }
    const bucketName = this.config.bucketName || 'agentplaza-media';
    const folderName = buildFolderName({ appId: resolvedAppId, direction, date });
    const safeOriginalName = sanitizeFileName(originalName || filename || `${mediaKind || 'media'}.bin`);
    const fileName = `${sanitizeFileName(messageId || 'message')}_${index}_${safeOriginalName}`;
    const objectKey = `${folderName}${fileName}`;
    const mediaBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    const uploadSize = Number.isFinite(size) && size > 0 ? size : mediaBuffer.length;
    const uploadMeta = {
      bindingId: resolvedBindingId,
      messageId: toSafeString(messageId),
      direction,
      mediaKind,
      mimeType,
      size: uploadSize,
      objectKeyHash: createHashValue(objectKey),
      ossUrlHash: '',
      sha256: createHashValue(mediaBuffer),
      wecomMediaIdHash: createHashValue(wecomMediaId)
    };

    writeStructuredLog(this.logger, 'info', '[WeComMediaStorage] upload started', uploadMeta);

    const formData = new this.FormDataClass();
    formData.append('bucketName', bucketName);
    formData.append('folderName', folderName);
    formData.append('fileName', fileName);
    formData.append('file', mediaBuffer, fileName);

    try {
      const response = await this.axiosClient.post(
        this.config.uploadUrl,
        formData,
        {
          headers: typeof formData.getHeaders === 'function' ? formData.getHeaders() : {},
          timeout: this.config.uploadTimeoutMs || 15000
        }
      );
      const responseCode = response?.data && typeof response.data === 'object'
        ? response.data.code
        : undefined;
      if (responseCode !== undefined && responseCode !== null && Number(responseCode) !== 0) {
        const numericResponseCode = Number(responseCode);
        throw new WecomMediaStorageServiceError(
          'MEDIA_STORAGE_UPLOAD_REJECTED',
          'media storage rejected media upload',
          { responseCode: Number.isFinite(numericResponseCode) ? numericResponseCode : '' }
        );
      }
      const uploadUrl = getUploadResponseUrl(response?.data);
      const ossUrl = normalizeUploadUrl(uploadUrl, this.config.allowedHosts, {
        publicBaseUrl: this.config.publicBaseUrl || '',
        trustedSourceHosts: [
          getUrlHost(this.config.uploadUrl),
          ...(this.config.uploadResponseHosts || [])
        ]
      });
      const accessCheck = await verifyAccessibleUrl({
        axiosClient: this.axiosClient,
        url: ossUrl,
        timeoutMs: this.config.verifyTimeoutMs || 3000
      });

      const resolvedObjectKey = resolveObjectKey({
        ossUrl,
        bucketName,
        folderName,
        fileName
      });
      const result = {
        kind: mediaKind,
        type: mediaKind,
        direction,
        name: safeOriginalName,
        originalName: safeOriginalName,
        mimeType,
        size: uploadSize,
        bucketName,
        folderName,
        ossUrl,
        url: ossUrl,
        ossUrlHash: createHashValue(ossUrl),
        objectKey: resolvedObjectKey,
        ossObjectKey: resolvedObjectKey,
        sha256: createHashValue(mediaBuffer)
      };

      await this.persistMediaAsset({
        bindingId: resolvedBindingId,
        messageId,
        direction,
        externalUserId,
        conversationKey,
        mediaKind,
        source,
        originalName: safeOriginalName,
        mimeType,
        extension: getExtension(safeOriginalName),
        size: uploadSize,
        wecomMediaIdHash: createHashValue(wecomMediaId),
        ossUrl,
        ossUrlHash: result.ossUrlHash,
        ossBucketName: bucketName,
        ossFolderName: folderName,
        ossObjectKey: resolvedObjectKey,
        sha256: result.sha256,
        status: 'uploaded'
      });

      writeStructuredLog(this.logger, 'info', '[WeComMediaStorage] upload finished', {
        ...uploadMeta,
        ossUrlHash: result.ossUrlHash,
        ...buildOssUrlDiagnostics(ossUrl),
        accessCheck,
        objectKeyLength: resolvedObjectKey.length
      });

      return result;
    } catch (error) {
      const code = error?.code === 'ECONNABORTED'
        ? 'MEDIA_STORAGE_UPLOAD_TIMEOUT'
        : (error instanceof WecomMediaStorageServiceError ? error.code : 'MEDIA_STORAGE_UPLOAD_FAILED');
      const wrapped = error instanceof WecomMediaStorageServiceError
        ? error
        : new WecomMediaStorageServiceError(code, sanitizeMediaSummary(error), { cause: error });

      writeStructuredLog(this.logger, 'error', '[WeComMediaStorage] upload failed', {
        ...uploadMeta,
        errorCode: wrapped.code,
        errorSummary: sanitizeMediaSummary(wrapped),
        responseCode: wrapped.responseCode ?? ''
      });
      throw wrapped;
    }
  }

  /**
   * 持久化媒体资源审计记录。
   * 输入: 已脱敏或哈希后的媒体元数据。
   * 输出: 创建结果；没有模型或 bindingId 时静默跳过。
   */
  async persistMediaAsset(record) {
    if (!this.MediaAssetModel || typeof this.MediaAssetModel.create !== 'function' || !record?.bindingId) {
      return null;
    }

    return this.MediaAssetModel.create(record);
  }
}

/**
 * 创建默认媒体存储服务。
 * 输入: 可选依赖覆盖。
 * 输出: 使用 WecomBotMediaAsset 模型的媒体存储服务实例。
 */
function createWecomMediaStorageService(options = {}) {
  return new WecomMediaStorageService({
    MediaAssetModel: WecomBotMediaAsset,
    ...options
  });
}

module.exports = {
  WecomMediaStorageService,
  WecomMediaStorageServiceError,
  createHashValue,
  createWecomMediaStorageService,
  sanitizeMediaSummary
};
