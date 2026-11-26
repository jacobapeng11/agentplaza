'use strict';
const logger = require('../utils/logger');

/**
 * 通用用户认证中间件
 *
 * 验证 Authorization / AuthToken header，成功后将用户信息挂到 req.user。
 */

const { getUserInfoFromToken } = require('../utils/auth');

async function userAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.authtoken;

  if (!authHeader) {
    return res.status(401).json({ success: false, message: '未提供认证令牌' });
  }

  let userInfo;
  try {
    userInfo = await getUserInfoFromToken(authHeader);
  } catch (err) {
    logger.error('[userAuth] token 验证异常:', err.message);
    return res.status(401).json({ success: false, message: '认证令牌无效或已过期' });
  }

  if (!userInfo || !userInfo.Badge) {
    return res.status(401).json({ success: false, message: '无法获取用户信息，请重新登录' });
  }

  req.user = userInfo;
  next();
}

module.exports = userAuth;
