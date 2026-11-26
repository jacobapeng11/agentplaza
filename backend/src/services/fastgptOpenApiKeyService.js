const crypto = require('crypto');
const Apps = require('../models/Apps');
const FastgptOpenApiKey = require('../models/FastgptOpenApiKey');
const { wecomBotConfig } = require('../config/wecomBot');

const MAX_KEYS_PER_APP_MEMBER = 10;
const DEFAULT_OPENAPI_PREFIX = 'fastgpt';
const FIRST_CHAR_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const REST_CHAR_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
const MIN_RANDOM_STRING_LENGTH = 52;
const MAX_RANDOM_STRING_LENGTH = 65;

/**
 * FastGPT OpenAPI Key 服务错误。
 * 输入: 业务错误码、错误消息和可选 HTTP 状态码。
 * 输出: 带 code/statusCode 的 Error 实例，供路由或配置服务转换响应。
 */
class FastgptOpenApiKeyServiceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'FastgptOpenApiKeyServiceError';
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
 * 将任意 ID 转为字符串。
 * 输入: ObjectId、字符串或空值。
 * 输出: 可用于查询和响应的字符串。
 */
function toIdString(value) {
  if (value && typeof value.toString === 'function') {
    return value.toString();
  }

  return String(value || '');
}

/**
 * 生成 FastGPT OpenAPI Key 脱敏值。
 * 输入: 完整 API Key。
 * 输出: 仅保留后四位的脱敏字符串。
 */
function maskOpenApiKey(apiKey) {
  const value = String(apiKey || '');
  if (!value) {
    return '';
  }

  return `******${value.slice(-4)}`;
}

/**
 * 从给定字符集中安全随机选择一个字符。
 * 输入: 非空字符集字符串。
 * 输出: 字符集中的一个随机字符。
 */
function pickRandomChar(alphabet) {
  return alphabet[crypto.randomInt(0, alphabet.length)];
}

/**
 * 生成 FastGPT 兼容随机字符串。
 * 输入: 目标长度，默认生成 FastGPT OpenAPI Key 所需长度。
 * 输出: 首位为小写字母、后续为大小写字母或数字的随机字符串。
 */
function createFastgptNanoid(size) {
  const firstChar = pickRandomChar(FIRST_CHAR_ALPHABET);
  if (size === 1) {
    return firstChar;
  }

  let randomsStr = '';
  for (let index = 1; index < size; index += 1) {
    randomsStr += pickRandomChar(REST_CHAR_ALPHABET);
  }

  return `${firstChar}${randomsStr}`;
}

/**
 * 生成新的 FastGPT OpenAPI Key。
 * 输入: 可选 OpenAPI Key 前缀，未传入时读取项目配置并兜底 fastgpt。
 * 输出: {openapiPrefix}-{randomString} 格式的完整 key。
 */
function createDefaultApiKey(openapiPrefix = wecomBotConfig.fastgpt?.openapiPrefix || DEFAULT_OPENAPI_PREFIX) {
  const size = crypto.randomInt(MIN_RANDOM_STRING_LENGTH, MAX_RANDOM_STRING_LENGTH + 1);
  const nanoid = createFastgptNanoid(size);
  return `${openapiPrefix || DEFAULT_OPENAPI_PREFIX}-${nanoid}`;
}

/**
 * 序列化 OpenAPI Key 为前端安全字段。
 * 输入: openapis 集合文档。
 * 输出: 只包含 id、名称、脱敏 key 和创建时间的 DTO。
 */
function serializeOpenApiKey(key) {
  return {
    id: toIdString(key?._id),
    name: key?.name || 'Api Key',
    apiKeyMasked: maskOpenApiKey(key?.apiKey),
    createTime: key?.createTime || null
  };
}

/**
 * 创建 FastGPT OpenAPI Key 服务实例。
 * 输入: 可注入的 openapis 模型、Apps 模型和 key 生成器。
 * 输出: 查询、创建和归属校验方法集合。
 */
function createFastgptOpenApiKeyService({
  OpenApiKeyModel = FastgptOpenApiKey,
  AppsModel = Apps,
  apiKeyFactory = createDefaultApiKey
} = {}) {
  /**
   * 读取当前 FastGPT 应用。
   * 输入: FastGPT 应用 ID。
   * 输出: Apps 文档；不存在或缺少归属字段时抛出业务错误。
   */
  async function findApp(appId) {
    const app = await AppsModel.findById(appId).lean();
    if (!app) {
      throw new FastgptOpenApiKeyServiceError('APP_NOT_FOUND', 'FastGPT app not found', 404);
    }

    if (!app.teamId || !app.tmbId) {
      throw new FastgptOpenApiKeyServiceError(
        'FASTGPT_OPENAPI_KEY_OWNER_MISSING',
        'FastGPT app teamId or tmbId is missing'
      );
    }

    return app;
  }

  /**
   * 查询当前应用已有 OpenAPI Key。
   * 输入: FastGPT 应用 ID。
   * 输出: 前端安全的 key 列表，不包含完整 key 或使用量。
   */
  async function listKeys(appId) {
    await findApp(appId);

    const query = OpenApiKeyModel.find({ appId: toIdString(appId) });
    if (query && typeof query.select === 'function') {
      query.select('+apiKey');
    }
    if (query && typeof query.sort === 'function') {
      query.sort({ createTime: -1, _id: -1 });
    }
    if (query && typeof query.lean === 'function') {
      query.lean();
    }

    const keys = await executeQuery(query);
    return {
      keys: (keys || []).map(serializeOpenApiKey)
    };
  }

  /**
   * 创建当前应用级 OpenAPI Key。
   * 输入: FastGPT 应用 ID 和可选名称。
   * 输出: 新建 key 的前端安全 DTO。
   */
  async function createKey(appId, payload = {}) {
    const app = await findApp(appId);
    const normalizedAppId = toIdString(appId);
    const tmbId = app.tmbId;
    const count = await OpenApiKeyModel.countDocuments({
      appId: normalizedAppId,
      tmbId
    });

    if (count >= MAX_KEYS_PER_APP_MEMBER) {
      throw new FastgptOpenApiKeyServiceError(
        'FASTGPT_OPENAPI_KEY_LIMIT_EXCEEDED',
        'FastGPT OpenAPI Key limit exceeded'
      );
    }

    const name = String(payload.name || '').trim() || `企业微信 Bot - ${app.name || normalizedAppId}`;
    const created = await OpenApiKeyModel.create({
      appId: normalizedAppId,
      teamId: app.teamId,
      tmbId,
      name,
      apiKey: apiKeyFactory(),
      usagePoints: 0,
      limit: { maxUsagePoints: -1 },
      createTime: new Date()
    });

    return {
      key: {
        ...serializeOpenApiKey(created),
        apiKey: created.apiKey
      }
    };
  }

  /**
   * 读取并校验 OpenAPI Key 属于当前应用。
   * 输入: FastGPT 应用 ID 和 key ID。
   * 输出: 含完整 apiKey 的 key 记录；不匹配时抛出业务错误。
   */
  async function resolveKeyForApp(appId, keyId) {
    if (!keyId) {
      throw new FastgptOpenApiKeyServiceError(
        'FASTGPT_OPENAPI_KEY_REQUIRED',
        'FastGPT OpenAPI Key is required'
      );
    }

    const query = OpenApiKeyModel.findById(keyId);
    if (query && typeof query.select === 'function') {
      query.select('+apiKey');
    }
    if (query && typeof query.lean === 'function') {
      query.lean();
    }

    const key = await executeQuery(query);
    if (!key) {
      throw new FastgptOpenApiKeyServiceError(
        'FASTGPT_OPENAPI_KEY_NOT_FOUND',
        'FastGPT OpenAPI Key not found',
        404
      );
    }

    if (toIdString(key.appId) !== toIdString(appId)) {
      throw new FastgptOpenApiKeyServiceError(
        'FASTGPT_OPENAPI_KEY_APP_MISMATCH',
        'FastGPT OpenAPI Key does not belong to this app'
      );
    }

    if (!key.apiKey) {
      throw new FastgptOpenApiKeyServiceError(
        'FASTGPT_OPENAPI_KEY_NOT_FOUND',
        'FastGPT OpenAPI Key secret is missing'
      );
    }

    return {
      ...key,
      id: toIdString(key._id),
      apiKeyMasked: maskOpenApiKey(key.apiKey)
    };
  }

  return {
    listKeys,
    createKey,
    resolveKeyForApp
  };
}

module.exports = {
  MAX_KEYS_PER_APP_MEMBER,
  FastgptOpenApiKeyServiceError,
  createDefaultApiKey,
  createFastgptNanoid,
  createFastgptOpenApiKeyService,
  maskOpenApiKey,
  serializeOpenApiKey
};
