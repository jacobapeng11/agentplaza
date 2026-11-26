const express = require('express');
const { getUserInfoFromToken } = require('../utils/auth');
const {
  createWecomBotConfigService,
  WecomBotConfigServiceError
} = require('../services/wecomBotConfigService');
const { getWecomBotWorkerScheduler } = require('../services/wecomBotWorkerRuntime');
const { createFastgptOpenApiKeyService } = require('../services/fastgptOpenApiKeyService');
const { createFastgptAppPermissionService } = require('../services/fastgptAppPermissionService');

const router = express.Router({ mergeParams: true });
const configService = createWecomBotConfigService({
  scheduler: getWecomBotWorkerScheduler()
});
const openApiKeyService = createFastgptOpenApiKeyService();
const permissionService = createFastgptAppPermissionService();

const APP_EDIT_PERMISSION_ERROR = {
  code: 403,
  success: false,
  errorCode: 'APP_EDIT_PERMISSION_REQUIRED',
  message: '当前用户无权配置该应用的企业微信 Bot'
};

/**
 * 发送应用编辑权限不足响应。
 * 输入: Express 响应对象。
 * 输出: 403 JSON 响应。
 */
function sendAppEditPermissionError(res) {
  return res.status(403).json(APP_EDIT_PERMISSION_ERROR);
}

/**
 * 从登录态用户信息中提取管理员工号。
 * 输入: token 解析后的用户信息。
 * 输出: 可写入审计上下文的工号字符串，缺失时为空字符串。
 */
function getAdminBadge(userInfo) {
  return String(userInfo?.Badge || userInfo?.employeeNumber || userInfo?.name || '');
}

/**
 * 验证普通登录态并检查应用编辑权限。
 * 输入: Express 请求、响应和 next 回调，路径参数包含 appId。
 * 输出: 鉴权通过时写入 req.user/可选 req.adminBadge 并进入后续处理，否则返回 401/403。
 */
async function requireWecomBotConfigPermission(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.authtoken;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: '未提供认证令牌'
    });
  }

  let userInfo;
  try {
    userInfo = await getUserInfoFromToken(authHeader);
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: '认证令牌无效或已过期'
    });
  }

  if (!userInfo) {
    return res.status(401).json({
      success: false,
      message: '无法获取用户信息'
    });
  }

  let permissionResult;
  try {
    permissionResult = await permissionService.canConfigureWecomBot(req.params.appId, userInfo);
  } catch (error) {
    return sendAppEditPermissionError(res);
  }

  if (!permissionResult?.allowed) {
    return sendAppEditPermissionError(res);
  }

  req.user = userInfo;
  if (permissionResult.isAdminOverride) {
    req.adminBadge = getAdminBadge(userInfo);
  }

  return next();
}

/**
 * 发送统一成功响应。
 * 输入: Express 响应对象、数据、消息。
 * 输出: 200 JSON 响应。
 */
function sendSuccess(res, data, message = 'success') {
  return res.status(200).json({
    code: 200,
    success: true,
    message,
    data
  });
}

/**
 * 净化错误响应消息中的敏感值。
 * 输入: 任意错误消息。
 * 输出: 不包含 Secret、API Key 或 Token 明显值的消息。
 */
function sanitizeResponseMessage(message) {
  return String(message || '服务器内部错误')
    .replace(/(api[_-]?key|secret|token)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]')
    .replace(/(Bearer\s+)[^\s,]+/gi, '$1[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-[REDACTED]')
    .slice(0, 500);
}

/**
 * 发送统一错误响应。
 * 输入: Express 响应对象和业务/系统错误。
 * 输出: 带 code/success/errorCode/message 的 JSON 错误响应。
 */
function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({
    code: statusCode,
    success: false,
    errorCode: error.code || 'INTERNAL_ERROR',
    message: sanitizeResponseMessage(error.message)
  });
}

/**
 * 解析启停请求中的 enabled 字段。
 * 输入: Express 请求体。
 * 输出: boolean；缺失或非 boolean 时抛出 400 业务错误。
 */
function parseEnabledBody(body) {
  if (typeof body?.enabled !== 'boolean') {
    const error = new Error('enabled must be a boolean');
    error.code = 'INVALID_ENABLED';
    error.statusCode = 400;
    throw error;
  }

  return body.enabled;
}

/**
 * 查询企业微信 Bot 配置。
 * 输入: Express 请求和响应对象，路径参数包含 appId。
 * 输出: 已配置 config 或未配置 defaults 的统一 JSON 响应。
 */
async function getWecomBotConfig(req, res) {
  try {
    const result = await configService.getConfig(req.params.appId);
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 保存企业微信 Bot 配置。
 * 输入: Express 请求和响应对象，路径参数 appId，请求体为 Bot 配置。
 * 输出: 保存后的配置 DTO，Secret 仅返回脱敏状态。
 */
async function saveWecomBotConfig(req, res) {
  try {
    const result = await configService.saveConfig(req.params.appId, req.body, {
      adminBadge: req.adminBadge,
      user: req.user
    });
    return sendSuccess(res, result, '保存成功');
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 显式展示企业微信 Bot Secret 明文。
 * 输入: Express 请求和响应对象，路径参数 appId。
 * 输出: 受管理员鉴权保护的 Secret 明文响应。
 */
async function revealWecomBotSecret(req, res) {
  try {
    const result = await configService.revealSecret(req.params.appId, {
      adminBadge: req.adminBadge,
      user: req.user
    });
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 启用或停用企业微信 Bot。
 * 输入: Express 请求和响应对象，路径参数 appId，请求体包含 enabled。
 * 输出: Worker 目标状态和连接状态的统一 JSON 响应。
 */
async function setWecomBotEnabled(req, res) {
  try {
    const result = await configService.setEnabled(req.params.appId, parseEnabledBody(req.body), {
      adminBadge: req.adminBadge,
      user: req.user
    });
    return sendSuccess(res, result, '操作成功');
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 查询当前 FastGPT 应用的 OpenAPI Key 列表。
 * 输入: Express 请求和响应对象，路径参数包含 appId。
 * 输出: 只包含名称、脱敏 key 和创建时间的统一 JSON 响应。
 */
async function listFastgptOpenApiKeys(req, res) {
  try {
    const result = await openApiKeyService.listKeys(req.params.appId);
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 为当前 FastGPT 应用创建 OpenAPI Key。
 * 输入: Express 请求和响应对象，请求体包含可选名称。
 * 输出: 新 key 的脱敏展示字段和仅创建时返回的完整 key。
 */
async function createFastgptOpenApiKey(req, res) {
  try {
    const result = await openApiKeyService.createKey(req.params.appId, req.body || {});
    return sendSuccess(res, result, '创建成功');
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 测试企业微信 Bot 连接。
 * 输入: Express 请求和响应对象，路径参数 appId，请求体包含测试凭证语义。
 * 输出: 订阅验证成功或脱敏错误响应。
 */
async function testWecomBotConnection(req, res) {
  try {
    const result = await configService.testConnection(req.params.appId, req.body || {});
    return sendSuccess(res, result, '订阅验证成功');
  } catch (error) {
    return sendError(res, error);
  }
}

router.get('/:appId/wecom-bot', requireWecomBotConfigPermission, getWecomBotConfig);
router.get('/:appId/wecom-bot/fastgpt-openapi-keys', requireWecomBotConfigPermission, listFastgptOpenApiKeys);
router.post('/:appId/wecom-bot/fastgpt-openapi-keys', requireWecomBotConfigPermission, createFastgptOpenApiKey);
router.post('/:appId/wecom-bot/secret/reveal', requireWecomBotConfigPermission, revealWecomBotSecret);
router.put('/:appId/wecom-bot', requireWecomBotConfigPermission, saveWecomBotConfig);
router.put('/:appId/wecom-bot/enabled', requireWecomBotConfigPermission, setWecomBotEnabled);
router.post('/:appId/wecom-bot/test-connection', requireWecomBotConfigPermission, testWecomBotConnection);

module.exports = router;
