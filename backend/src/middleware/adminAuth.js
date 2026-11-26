const logger = require('../utils/logger');
/**
 * 管理员权限认证中间件
 * 
 * 验证用户是否为管理员（通过 ADMIN_BADGES 配置的工号白名单）
 */

const { getUserInfoFromToken } = require('../utils/auth');
const { resolveAdminBadges } = require('../config/adminBadges');

// 管理员工号白名单
const ADMIN_BADGES = resolveAdminBadges();

/**
 * 管理员权限验证中间件
 * 
 * 使用方法：
 * router.get('/admin/apps', adminAuth, async (req, res) => { ... });
 * 
 * 验证成功后，req.user 将包含用户信息
 */
async function adminAuth(req, res, next) {
  try {
    // 1. 获取认证 token
    const authHeader = req.headers.authorization || req.headers.authtoken;
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: '未提供认证令牌'
      });
    }

    // 2. 验证 token 并获取用户信息
    let userInfo;
    try {
      userInfo = await getUserInfoFromToken(authHeader);
    } catch (error) {
      logger.error('[adminAuth] Token验证失败:', error);
      return res.status(401).json({
        success: false,
        message: '认证令牌无效或已过期'
      });
    }

    if (!userInfo || !userInfo.Badge) {
      return res.status(401).json({
        success: false,
        message: '无法获取用户信息'
      });
    }

    // 3. 检查用户工号是否在管理员白名单中
    const userBadge = String(userInfo.Badge);
    
    if (!ADMIN_BADGES.includes(userBadge)) {
      logger.warn(`[adminAuth] 非管理员尝试访问管理接口: Badge=${userBadge}`);
      return res.status(403).json({
        success: false,
        message: '权限不足，仅管理员可访问'
      });
    }

    // 4. 验证成功，将用户信息附加到请求对象
    req.user = userInfo;
    req.adminBadge = userBadge;
    
    logger.debug(`[adminAuth] 管理员认证成功: Badge=${userBadge}, Name=${userInfo.Name || 'N/A'}`);
    
    next();
  } catch (error) {
    logger.error('[adminAuth] 中间件错误:', error);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误'
    });
  }
}

module.exports = adminAuth;
