const Apps = require('../models/Apps');
const AppsLink = require('../models/AppsLink');
const AppsNew = require('../models/AppsNew');

/**
 * 企业微信 Bot 应用解析错误。
 * 输入: 业务错误码、错误消息和 HTTP 状态码。
 * 输出: 可由配置服务或路由转换成统一响应的 Error 实例。
 */
class WecomBotAppResolverError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'WecomBotAppResolverError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * 按 ID 查询模型并返回 lean 对象。
 * 输入: Mongoose 模型和应用 ID。
 * 输出: 查询到的普通对象；模型不可用或未命中时返回 null。
 */
async function findByIdLean(Model, id) {
  if (!Model || typeof Model.findById !== 'function') {
    return null;
  }

  return Model.findById(id).lean();
}

/**
 * 解析可绑定企业微信 Bot 的普通 FastGPT 应用。
 * 输入: plaza 卡片传入的应用 ID，以及可注入的 Apps/AppsLink/AppsNew 模型。
 * 输出: 可绑定的 FastGPT 应用信息；外链或展示记录误用时抛出业务错误。
 */
async function resolveBindableFastgptApp(appId, {
  AppsModel = Apps,
  AppsLinkModel = AppsLink,
  AppsNewModel = AppsNew
} = {}) {
  const app = await findByIdLean(AppsModel, appId);
  if (app) {
    return { app, appSource: 'fastgpt' };
  }

  const linkApp = await findByIdLean(AppsLinkModel, appId);
  if (linkApp) {
    throw new WecomBotAppResolverError('UNSUPPORTED_APP_SOURCE', 'External link apps cannot bind WeCom bots');
  }

  const displayApp = await findByIdLean(AppsNewModel, appId);
  if (displayApp) {
    throw new WecomBotAppResolverError('APP_NOT_FOUND', 'AppsNew display records are not bindable without a matching Apps document', 404);
  }

  throw new WecomBotAppResolverError('APP_NOT_FOUND', 'FastGPT app not found', 404);
}

module.exports = {
  resolveBindableFastgptApp,
  WecomBotAppResolverError
};
