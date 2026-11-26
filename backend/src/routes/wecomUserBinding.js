const express = require('express');
const { verifyToken } = require('../utils/auth');
const {
  createWecomUserBindingService,
  WecomUserBindingServiceError
} = require('../services/wecomUserBindingService');

const router = express.Router();

/**
 * 生成统一成功响应。
 * 输入: Express 响应对象、消息和数据。
 * 输出: 写入 JSON 响应。
 */
function sendSuccess(res, message, data) {
  return res.json({
    code: 200,
    success: true,
    message,
    data
  });
}

/**
 * 生成统一错误响应。
 * 输入: Express 响应对象和业务错误。
 * 输出: 写入不含敏感 ID 的 JSON 错误响应。
 */
function sendError(res, error) {
  const statusCode = error?.statusCode || 500;
  return res.status(statusCode).json({
    code: statusCode,
    success: false,
    errorCode: error?.code || 'BIND_WECOM_USER_FAILED',
    message: error?.message || '企业微信用户绑定失败'
  });
}

router.post('/user-binding/bind', verifyToken, async (req, res) => {
  const service = createWecomUserBindingService();

  try {
    const result = await service.bindCurrentUser({
      qwToken: req.body?.qwToken,
      currentUser: req.user
    });

    return sendSuccess(res, '认证成功', result);
  } catch (error) {
    if (error instanceof WecomUserBindingServiceError || error?.code) {
      return sendError(res, error);
    }

    return sendError(res, new WecomUserBindingServiceError(
      'BIND_WECOM_USER_FAILED',
      '企业微信用户绑定失败',
      500,
      { cause: error }
    ));
  }
});

module.exports = router;
