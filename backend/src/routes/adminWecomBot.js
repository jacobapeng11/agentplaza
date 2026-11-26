const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const { createWecomBotConfigService } = require('../services/wecomBotConfigService');
const { createWecomBotAdminService } = require('../services/wecomBotAdminService');
const { getWecomBotWorkerScheduler } = require('../services/wecomBotWorkerRuntime');
const { createFastgptOpenApiKeyService } = require('../services/fastgptOpenApiKeyService');

const router = express.Router();
const configService = createWecomBotConfigService({
  scheduler: getWecomBotWorkerScheduler()
});
const openApiKeyService = createFastgptOpenApiKeyService();
const adminService = createWecomBotAdminService({ configService });

/**
 * 发送统一成功响应。
 * 输入: Express 响应对象、响应数据和可选消息。
 * 输出: code/success/message/data 结构的 200 JSON 响应。
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
 * 输入: 任意错误消息文本。
 * 输出: 已脱敏并截断到 500 字符以内的安全消息。
 */
function sanitizeResponseMessage(message) {
  return String(message || '服务器内部错误')
    .replace(/(api[_-]?key|secret|token)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]')
    .replace(/(Bearer\s+)[^\s,]+/gi, '$1[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-[REDACTED]')
    .replace(/\braw\s+payload\b/gi, '[REDACTED_PAYLOAD]')
    .replace(/\bfastgpt-[A-Za-z0-9_-]+\b/gi, 'fastgpt-[REDACTED]')
    .slice(0, 500);
}

/**
 * 发送统一错误响应。
 * 输入: Express 响应对象和业务/系统错误。
 * 输出: 带状态码、错误码和脱敏消息的 JSON 响应。
 */
function sendError(res, error) {
  const statusCode = error?.statusCode || 500;
  return res.status(statusCode).json({
    code: statusCode,
    success: false,
    errorCode: error?.code || 'INTERNAL_ERROR',
    message: sanitizeResponseMessage(error?.message)
  });
}

/**
 * 映射管理员鉴权失败错误码。
 * 输入: adminAuth 返回的 HTTP 状态码。
 * 输出: 当前路由统一错误信封使用的错误码。
 */
function getAdminAuthErrorCode(statusCode) {
  if (statusCode === 401) {
    return 'ADMIN_AUTH_REQUIRED';
  }

  if (statusCode === 403) {
    return 'ADMIN_PERMISSION_DENIED';
  }

  return 'ADMIN_AUTH_FAILED';
}

/**
 * 发送管理员鉴权统一错误响应。
 * 输入: Express 响应对象、HTTP 状态码和原始鉴权消息。
 * 输出: 带 code/success/errorCode/message 的 JSON 错误响应。
 */
function sendAdminAuthError(res, statusCode, message) {
  return res.status(statusCode).json({
    code: statusCode,
    success: false,
    errorCode: getAdminAuthErrorCode(statusCode),
    message: sanitizeResponseMessage(message || '管理员认证失败')
  });
}

/**
 * 包装全局 adminAuth 并统一本路由的鉴权失败响应。
 * 输入: Express 请求、响应和 next 回调。
 * 输出: 鉴权成功时进入后续处理；401/403 失败时返回本路由统一错误信封。
 */
async function adminWecomBotAuth(req, res, next) {
  const originalStatus = res.status;
  const originalJson = res.json;
  let capturedStatusCode = 200;
  let completed = false;

  /**
   * 还原被临时接管的响应方法。
   * 输入: 无。
   * 输出: res.status/res.json 恢复为 Express 原方法。
   */
  function restoreResponseWriters() {
    res.status = originalStatus;
    res.json = originalJson;
  }

  res.status = function captureAuthStatus(statusCode) {
    capturedStatusCode = statusCode;
    return res;
  };
  res.json = function captureAuthJson(body) {
    if (completed) {
      return originalJson.call(res, body);
    }

    completed = true;
    restoreResponseWriters();
    if (capturedStatusCode === 401 || capturedStatusCode === 403) {
      return sendAdminAuthError(res, capturedStatusCode, body?.message);
    }

    return originalStatus.call(res, capturedStatusCode).json(body);
  };

  try {
    await adminAuth(req, res, (error) => {
      if (completed) {
        return;
      }

      completed = true;
      restoreResponseWriters();
      next(error);
    });
  } catch (error) {
    if (!completed) {
      completed = true;
      restoreResponseWriters();
      next(error);
    }
  } finally {
    if (!completed) {
      restoreResponseWriters();
    }
  }
}

/**
 * 创建管理员操作上下文。
 * 输入: 已通过 adminAuth 的 Express 请求对象。
 * 输出: 包含管理员工号和用户信息的服务调用上下文。
 */
function createAdminContext(req) {
  return {
    adminBadge: req.adminBadge,
    user: req.user
  };
}

/**
 * 查询管理员视角的企业微信 Bot 配置。
 * 输入: Express 请求和响应对象，路径参数包含 appId。
 * 输出: 当前应用的 Bot 配置 JSON 响应。
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
 * 保存管理员视角的企业微信 Bot 配置。
 * 输入: Express 请求和响应对象，路径参数 appId，请求体为 Bot 配置。
 * 输出: 保存后的 Bot 配置 JSON 响应。
 */
async function saveWecomBotConfig(req, res) {
  try {
    const result = await configService.saveConfig(req.params.appId, req.body || {}, createAdminContext(req));
    return sendSuccess(res, result, '保存成功');
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 显示企业微信 Bot Secret 明文。
 * 输入: Express 请求和响应对象，路径参数包含 appId。
 * 输出: 仅管理员可访问的 Secret 明文 JSON 响应。
 */
async function revealWecomBotSecret(req, res) {
  try {
    const result = await configService.revealSecret(req.params.appId, createAdminContext(req));
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 查询 FastGPT OpenAPI Key 列表。
 * 输入: Express 请求和响应对象，路径参数包含 appId。
 * 输出: 当前应用可用于 Bot 的 Key 列表 JSON 响应。
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
 * 创建 FastGPT OpenAPI Key。
 * 输入: Express 请求和响应对象，路径参数 appId，请求体为 Key 创建参数。
 * 输出: 新建 Key 的 JSON 响应。
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
 * 输入: Express 请求和响应对象，路径参数 appId，请求体为连接测试参数。
 * 输出: 连接测试结果 JSON 响应。
 */
async function testWecomBotConnection(req, res) {
  try {
    const result = await configService.testConnection(req.params.appId, req.body || {});
    return sendSuccess(res, result, '订阅验证成功');
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 重新激活单个应用的企业微信 Bot。
 * 输入: Express 请求和响应对象，路径参数包含 appId。
 * 输出: 单应用重新激活结果 JSON 响应。
 */
async function reactivateOneWecomBot(req, res) {
  try {
    const result = await adminService.reactivateOne(req.params.appId, createAdminContext(req));
    return sendSuccess(res, result, '重新激活成功');
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * 批量重新激活选中的企业微信 Bot。
 * 输入: Express 请求和响应对象，请求体可包含 appIds 数组。
 * 输出: 批量重新激活统计和逐项结果 JSON 响应。
 */
async function reactivateManyWecomBots(req, res) {
  try {
    const appIds = Array.isArray(req.body?.appIds) ? req.body.appIds : [];
    const result = await adminService.reactivateMany(appIds, createAdminContext(req));
    return sendSuccess(res, result, '批量重新激活完成');
  } catch (error) {
    return sendError(res, error);
  }
}

router.get('/apps/:appId/wecom-bot', adminWecomBotAuth, getWecomBotConfig);
router.put('/apps/:appId/wecom-bot', adminWecomBotAuth, saveWecomBotConfig);
router.post('/apps/:appId/wecom-bot/secret/reveal', adminWecomBotAuth, revealWecomBotSecret);
router.get('/apps/:appId/wecom-bot/fastgpt-openapi-keys', adminWecomBotAuth, listFastgptOpenApiKeys);
router.post('/apps/:appId/wecom-bot/fastgpt-openapi-keys', adminWecomBotAuth, createFastgptOpenApiKey);
router.post('/apps/:appId/wecom-bot/test-connection', adminWecomBotAuth, testWecomBotConnection);
router.put('/apps/:appId/wecom-bot/reactivate', adminWecomBotAuth, reactivateOneWecomBot);
router.put('/wecom-bots/reactivate', adminWecomBotAuth, reactivateManyWecomBots);

module.exports = router;
