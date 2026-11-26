const logger = require('../utils/logger');
const AppsLink = require('../models/AppsLink');

/**
 * 将权限字段归一化为数组。
 * 输入: 可能为空、数组或单值的权限字段。
 * 输出: 可安全遍历的数组。
 */
function normalizePermissionList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 构建外链应用权限过滤查询条件
 * @param {Object} userInfo - 用户信息 { Badge, DepartmentCode }
 * @returns {Object} MongoDB 查询条件
 */
function buildLinkAppPermissionFilter(userInfo) {
  const { Badge, DepartmentCode } = userInfo;
  
  logger.debug('[buildLinkAppPermissionFilter] 输入参数:', { Badge, DepartmentCode });
  
  // 确保Badge统一为字符串类型
  const badgeStr = String(Badge);
  
  const filters = [];
  
  // 1. 创建者的应用
  if (badgeStr) {
    filters.push({ 'creator.Badge': badgeStr });
  }
  
  // 2. 公开应用（无任何权限限制）
  filters.push({
    $and: [
      { userPermissions: { $size: 0 } },
      { deptPermissions: { $size: 0 } }
    ]
  });
  
  // 3. 人员权限精确匹配
  if (badgeStr) {
    filters.push({ userPermissions: badgeStr });
  }
  
  // 4. 部门权限匹配
  // 由于MongoDB查询限制，我们获取所有有部门权限的应用，然后在应用层过滤
  // 这里我们需要获取用户部门可能匹配的所有应用
  if (DepartmentCode) {
    // 生成用户部门的所有可能前缀
    // 例如：DepartmentCode = "12345678"
    // 可能匹配的权限：1, 12, 123, 1234, 12345, 123456, 1234567, 12345678
    const deptPrefixes = [];
    for (let i = 1; i <= DepartmentCode.length; i++) {
      deptPrefixes.push(DepartmentCode.substring(0, i));
    }
    
    logger.debug('[buildLinkAppPermissionFilter] 部门前缀:', deptPrefixes);
    
    // 查询deptPermissions中包含这些前缀的应用
    filters.push({
      deptPermissions: { $in: deptPrefixes }
    });
  }
  
  const query = { $or: filters };
  logger.debug('[buildLinkAppPermissionFilter] 生成的查询条件:', JSON.stringify(query, null, 2));
  
  // 如果没有任何过滤条件，返回只显示公开应用
  if (filters.length === 0) {
    return { 
      $and: [
        { userPermissions: { $size: 0 } },
        { deptPermissions: { $size: 0 } }
      ]
    };
  }
  
  return query;
}

/**
 * 检查用户是否有权访问特定应用
 * @param {string} appId - 应用 ID
 * @param {Object} userInfo - 用户信息
 * @returns {Promise<boolean>}
 */
async function checkUserHasAccessToLinkApp(appId, userInfo) {
  const app = await AppsLink.findById(appId);
  if (!app) return false;
  
  const { Badge, DepartmentCode } = userInfo;
  const userPermissions = normalizePermissionList(app.userPermissions);
  const deptPermissions = normalizePermissionList(app.deptPermissions);
  
  // 确保Badge统一为字符串类型进行比较
  const badgeStr = String(Badge);
  const creatorBadgeStr = app.creator?.Badge ? String(app.creator.Badge) : '';
  
  // 创建者始终有权限
  if (creatorBadgeStr && creatorBadgeStr === badgeStr) return true;
  
  // 如果应用没有任何权限限制（公开应用）
  if (userPermissions.length === 0 && deptPermissions.length === 0) {
    return true;
  }
  
  // 检查人员权限（统一转为字符串比较）
  if (userPermissions.some(p => String(p) === badgeStr)) return true;
  
  // 检查部门权限（模糊匹配）
  if (DepartmentCode && deptPermissions.some(dept =>
    DepartmentCode.startsWith(dept)
  )) return true;
  
  return false;
}

module.exports = {
  buildLinkAppPermissionFilter,
  checkUserHasAccessToLinkApp,
  normalizePermissionList
};
