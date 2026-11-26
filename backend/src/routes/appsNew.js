const logger = require('../utils/logger');
const express = require('express');
const router = express.Router();
const Apps = require('../models/Apps'); // 使用旧的 Apps 模型
const AppsNew = require('../models/AppsNew');
const AppsLink = require('../models/AppsLink'); // 外链应用模型
const Collect = require('../models/Collect');
const { appChatStats } = require('../services/appChatStatsService');
const adminAuth = require('../middleware/adminAuth');
router.use((req, res, next) => {
  const stats = appChatStats.status();
  if (stats.updatedAt !== null) {
    res.set('X-Chat-Stats-Updated-At', new Date(stats.updatedAt).toISOString());
    res.set('X-Chat-Stats-Stale', String(stats.stale));
  }
  next();
});
const { getUserInfoFromToken, verifyToken } = require('../utils/auth');
const { filterVisiblePlazaApps } = require('../utils/appVisibility');
const { createFastgptAppPermissionService } = require('../services/fastgptAppPermissionService');
const { createWecomBotAdminService } = require('../services/wecomBotAdminService');

const permissionService = createFastgptAppPermissionService();
const wecomBotAdminService = createWecomBotAdminService();

async function requirePlazaSession(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.authtoken;
    const user = await getUserInfoFromToken(authHeader);
    if (!user) {
      const message = authHeader ? 'Invalid authentication token or session expired' : 'Authentication required';
      return res.status(401).json({ code: 401, success: false, message, data: null });
    }
    res.locals.plazaUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * 辅助函数：为应用卡片附加企业微信 Bot 配置权限。
 * 输入: 应用卡片数组和登录态用户信息。
 * 输出: 原应用卡片数组；外链应用固定 false，普通应用按权限服务结果设置。
 */
async function attachWecomBotConfigurationPermission(apps, userInfo) {
  if (!Array.isArray(apps) || apps.length === 0) {
    return apps;
  }

  const regularApps = [];

  apps.forEach(app => {
    if (!app) {
      return;
    }

    const isLinkApp = app.isLinkApp === true || app.source === 'link';
    app.canConfigureWecomBot = false;

    if (!isLinkApp && app._id) {
      regularApps.push(app);
    }
  });

  const appIds = [...new Set(regularApps.map(app => app._id.toString()))];
  if (appIds.length === 0) {
    return apps;
  }

  try {
    const allowedIds = await permissionService.getConfigurableAppIds(appIds, userInfo || {}, regularApps);
    regularApps.forEach(app => {
      app.canConfigureWecomBot = allowedIds.has(app._id.toString());
    });
  } catch (error) {
    logger.error('[attachWecomBotConfigurationPermission] 获取企业微信 Bot 配置权限失败:', error);
    regularApps.forEach(app => {
      app.canConfigureWecomBot = false;
    });
  }

  return apps;
}

/**
 * 为广场卡片附加当前用户是否可实际打开应用的标记。
 * 普通应用复用 FastGPT 读权限；外链应用在查询时已按自身权限配置计算。
 * 权限查询失败时按无权限处理，但不再从广场列表删除卡片。
 */
async function attachApplicationAccessPermission(apps, userInfo) {
  if (!Array.isArray(apps) || apps.length === 0) {
    return apps;
  }

  const regularApps = apps.filter((app) => app && !app.isLinkApp && app._id);
  apps.forEach((app) => {
    if (!app) return;
    if (app.isLinkApp) {
      app.canAccess = app.canAccess === true;
    } else {
      app.canAccess = false;
    }
  });

  if (regularApps.length === 0) {
    return apps;
  }

  try {
    const allowedIds = await permissionService.getUsableAppIds(
      regularApps.map((app) => app._id.toString()),
      userInfo || {},
      regularApps
    );
    regularApps.forEach((app) => {
      app.canAccess = allowedIds.has(app._id.toString());
    });
  } catch (error) {
    logger.error('[attachApplicationAccessPermission] 获取应用使用权限失败:', error);
  }

  return apps;
}

/**
 * 辅助函数：获取全部外链应用并标记当前用户访问权限
 * @param {string} userBadge - 用户工号
 * @param {string} userDepartmentCode - 用户部门编码
 * @param {string} category - 分类（可选）
 * @returns {Array} 外链应用列表
 */
async function getLinkAppsWithAccess(userBadge, userDepartmentCode, category = null, search = '') {
  try {
    const query = {};
    
    // 如果指定了分类，添加分类过滤
    if (category && category !== 'all') {
      query.newType = category;
    }
    
    // 过滤已删除的应用
    query.isDeleted = { $ne: true };
    
    // 如果有搜索关键词，添加搜索条件
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { intro: { $regex: search, $options: 'i' } }
      ];
    }
    
    logger.debug(`[getLinkAppsWithAccess] 查询条件:`, JSON.stringify(query, null, 2));
    
    // 查询所有外链应用
    let linkApps = await AppsLink.find(query).lean();
    
    logger.debug(`[getLinkAppsWithAccess] 查询到 ${linkApps.length} 个外链应用，category: ${category}, search: ${search}`);
    if (linkApps.length > 0) {
      logger.debug(`[getLinkAppsWithAccess] 前3个应用:`, linkApps.slice(0, 3).map(a => ({ name: a.name, newType: a.newType })));
    }
    logger.debug(`[getLinkAppsWithAccess] 用户信息: Badge=${userBadge}, DepartmentCode=${userDepartmentCode}`);
    
    // 只标记权限，不过滤卡片；无权限用户仍可在广场发现应用。
    linkApps = linkApps.map(app => {
      // 检查是否配置了权限
      const hasDeptConfig = app.deptPermissions && app.deptPermissions.length > 0;
      const hasUserConfig = app.userPermissions && app.userPermissions.length > 0;
      
      // 检查是否是创建者（支持字符串和数字类型）
      let isCreator = false;
      if (app.creator && app.creator.Badge && userBadge) {
        const creatorBadge = String(app.creator.Badge);
        const userBadgeStr = String(userBadge);
        isCreator = creatorBadge === userBadgeStr;
      }
      
      // 如果没有配置任何权限，则为公开应用，所有人可见
      if (!hasDeptConfig && !hasUserConfig) {
        logger.debug(`[getLinkAppsWithAccess] 应用 ${app.name} 无权限配置，公开应用`);
        return { ...app, canAccess: true };
      }
      
      // 检查部门权限（前缀匹配：用户部门编码以权限部门编码开头）
      // 例如: 用户 DepartmentCode='S01012303', 应用 deptPermissions=['S010123']
      // 匹配: 'S01012303'.startsWith('S010123') = true
      let hasDeptPermission = false;
      if (hasDeptConfig && userDepartmentCode) {
        hasDeptPermission = app.deptPermissions.some(dept => {
          const match = userDepartmentCode.startsWith(dept);
          if (match) {
            logger.debug(`[getLinkAppsWithAccess] 应用 ${app.name} 部门权限匹配: 用户部门 ${userDepartmentCode} 以 ${dept} 开头`);
          }
          return match;
        });
      }
      
      // 检查人员权限（精确匹配，支持字符串和数字类型）
      let hasUserPermission = false;
      if (hasUserConfig && userBadge) {
        // 转换为字符串进行比较，因为 userPermissions 数组可能包含数字或字符串
        const userBadgeStr = String(userBadge);
        hasUserPermission = app.userPermissions.some(badge => {
          const badgeStr = String(badge);
          const match = badgeStr === userBadgeStr;
          if (match) {
            logger.debug(`[getLinkAppsWithAccess] 应用 ${app.name} 人员权限匹配: ${badgeStr}`);
          }
          return match;
        });
      }
      
      // 满足任一条件即可：部门权限 OR 人员权限 OR 创建者
      const hasPermission = hasDeptPermission || hasUserPermission || isCreator;
      
      if (!hasPermission) {
        logger.debug(`[getLinkAppsWithAccess] 应用 ${app.name} 无权限访问:`, {
          isCreator,
          hasDeptPermission,
          hasUserPermission,
          userBadge,
          userDepartmentCode,
          appDeptPermissions: app.deptPermissions,
          appUserPermissions: app.userPermissions
        });
      }
      
      return { ...app, canAccess: hasPermission };
    });
    
    const accessibleCount = linkApps.filter(app => app.canAccess).length;
    logger.debug(`[getLinkAppsWithAccess] 返回 ${linkApps.length} 个外链应用，其中 ${accessibleCount} 个可访问`);
    
    return linkApps;
  } catch (error) {
    logger.error('[getLinkApps] 查询外链应用失败:', error);
    return [];
  }
}

// 辅助：为应用列表附加创建人信息，优先通过 team_members.userId -> users.username 解析稳定工号。
async function attachCreatorInfo(apps) {
  try {
    if (!apps || apps.length === 0) return;

    const TeamMembers = require('../models/TeamMembers');
    const Users = require('../models/Users');
    const UsersDetail = require('../models/UsersDetail');

    // 收集唯一的 tmbId（只收集普通应用的，外链应用已有 creator 字段）
    const tmbIds = [...new Set(
      apps
        .filter(a => !a.isLinkApp) // 只处理普通应用
        .map(a => a.tmbId)
        .filter(Boolean)
        .map(id => id.toString())
    )];
    
    // 收集外链应用中需要补充姓名的工号
    const linkAppBadges = [...new Set(
      apps
        .filter(a => a.isLinkApp && a.creator && a.creator.Badge)
        .map(a => a.creator.Badge)
        .filter(Boolean)
    )];
    if (tmbIds.length === 0 && linkAppBadges.length === 0) {
      // 为普通应用设置 creator 为 null，外链应用保持不变
      apps.forEach(a => { 
        if (!a.isLinkApp) {
          a.creator = null; 
        }
      });
      return;
    }

    // 查询 team_members，并优先通过稳定的 userId 关联 users.username。
    const members = await TeamMembers.find({ _id: { $in: tmbIds } }).lean();
    const memberUserIds = [...new Set(members
      .map(member => member?.userId)
      .filter(Boolean)
      .map(userId => userId.toString()))];
    const users = memberUserIds.length > 0
      ? await Users.find({ _id: { $in: memberUserIds } }).select('_id username').lean()
      : [];
    const userIdToBadge = {};
    users.forEach(user => {
      if (user?._id && user?.username !== null && user?.username !== undefined) {
        userIdToBadge[user._id.toString()] = String(user.username);
      }
    });

    const tmbIdToBadge = {};
    const badgesSet = new Set();
    members.forEach(m => {
      if (!m || !m._id) return;
      const key = m._id.toString();
      const stableBadge = m.userId ? userIdToBadge[m.userId.toString()] : null;
      const badge = stableBadge || m.name;
      tmbIdToBadge[key] = badge;
      if (badge !== null && badge !== undefined && badge !== '') {
        badgesSet.add(badge);
      }
    });

    // 合并外链应用工号并统一转成字符串。
    const badges = Array.from(badgesSet);
    const allBadges = [...new Set([...badges, ...linkAppBadges].map(b => String(b)))];

    // 兼容 users_detail.Badge 在 DB 中为 string 或 number 的情况：
    // 用两条 $in 分别匹配字符串和数字，可命中 Badge 索引（原 $expr+$toString 会全表扫描）
    let userDetails = [];
    if (allBadges.length > 0) {
      const badgeStrs = allBadges.map(b => String(b));
      const badgeNums = [...new Set(
        badgeStrs.filter(b => /^\d+$/.test(b)).map(b => Number(b))
      )];
      const badgeConditions = [{ Badge: { $in: badgeStrs } }];
      if (badgeNums.length > 0) {
        badgeConditions.push({ Badge: { $in: badgeNums } });
      }
      const query = badgeConditions.length === 1 ? badgeConditions[0] : { $or: badgeConditions };
      userDetails = await UsersDetail.find(query).select('Badge Name').lean();
    }
    // 统一以字符串为 key，避免数字/字符串类型不一致导致查找失败
    const badgeToDetail = {};
    userDetails.forEach(u => {
      if (!u) return;
      badgeToDetail[String(u.Badge)] = u;
    });
    // 将信息合并到每个应用
    apps.forEach(app => {
      if (app.isLinkApp) {
        // 外链应用：补充 creator.Name（如果 Name 缺失或等于 Badge）
        if (app.creator && app.creator.Badge) {
          const badgeStr = String(app.creator.Badge);
          const detail = badgeToDetail[badgeStr];
          if (detail && detail.Name && detail.Name !== badgeStr) {
            // 从数据库补充真实姓名
            app.creator.Name = detail.Name;
          } else if (!app.creator.Name || app.creator.Name === badgeStr) {
            // 如果数据库也没有姓名，保持 Badge 作为显示
            app.creator.Name = null;
          }
          // 隐含 else：detail 未找到但 creator.Name 已是有效姓名 → 保留不变
        }
      } else {
        // 普通应用：原有逻辑
        const key = app.tmbId ? app.tmbId.toString() : null;
        const badge = key ? tmbIdToBadge[key] : null;
        const detail = badge ? badgeToDetail[String(badge)] : null;
        if (detail) {
          app.creator = { Badge: detail.Badge, Name: detail.Name };
        } else if (badge) {
          // 找不到 users_detail 时至少返回工号
          app.creator = { Badge: badge, Name: null };
        } else {
          app.creator = null;
        }
      }
    });
  } catch (err) {
    logger.error('[attachCreatorInfo] 错误:', err);
    // 不让错误阻断主流程；外链应用保留创建时已保存的 creator。
    apps.forEach(a => {
      if (!a.isLinkApp) {
        a.creator = null;
      }
    });
  }
}

/**
 * Plaza discovery keeps every application visible. Actual use permission is
 * represented by canAccess, so private applications are not removed here.
 */
function isPrivateApplication() {
  return false;
}

/**
 * @route   GET /api/apps-new/by-category
 * @desc    按分类获取全部应用（支持搜索、排序、分页，并返回 canAccess 使用权标记）
 * @access  Private (需要登录)
 * @query   {string} category - 分类ID (可选, 默认 'all')
 * @query   {string} search - 搜索关键词 (可选)
 * @query   {string} sortBy - 排序字段 (hotScore | createdAt, 默认 hotScore)
 * @query   {number} page - 页码 (默认 1)
 * @query   {number} limit - 每页数量 (默认 20)
 */
router.get('/apps-new/by-category', requirePlazaSession, async (req, res, next) => {
  try {
    const {
      category = 'all',
      search = '',
      sortBy = 'hotScore',
      page = 1,
      limit = 20
    } = req.query;

    const userInfo = res.locals.plazaUser;

    // ========== 权限过滤逻辑开始 ==========
    let allowedAppIds = null; // null 表示不进行权限过滤
    // 复用下方权限过滤阶段解析出的当前用户 tmbId，供私有应用过滤使用
    let currentUserTmbIds = [];

    // 从token获取用户信息
    if (userInfo) {
      try {
        if (userInfo.employeeNumber) {
          const TeamMembers = require('../models/TeamMembers');
          const ResourcePermissions = require('../models/ResourcePermissions');
          const TeamOrgs = require('../models/TeamOrgs');
          
          const employeeNumber = userInfo.employeeNumber;
          const userDepartmentCode = userInfo.DepartmentCode; // 用户所在部门编码
          
          // 1. 通过员工工号查询 team_members 表
          const teamMemberRecords = await TeamMembers.find({ name: employeeNumber }).lean();
          currentUserTmbIds = teamMemberRecords.map(member => member._id.toString());

          // 打印用户所属团队
          teamMemberRecords.forEach((member, index) => {
          });
          
          if (teamMemberRecords.length > 0 || userDepartmentCode) {
            // 2. 查询用户权限和团队权限
            const permissionQueries = [];
            
            teamMemberRecords.forEach(member => {
              // 情况1：匹配特定成员的权限
              permissionQueries.push({
                tmbId: member._id,
                teamId: member.teamId,
                resourceType: 'app'
              });
              
              // 情况2：匹配团队级别的权限
              permissionQueries.push({
                teamId: member.teamId,
                tmbId: { $in: [null, undefined] },
                resourceType: 'app'
              });
            });
            
            const permissionRecords = permissionQueries.length > 0
              ? await ResourcePermissions.find({ $or: permissionQueries }).lean()
              : [];
            
            
            // 3. 查询部门权限
            let departmentAppIds = [];
            if (userDepartmentCode) {
              // 3.1 查询所有有 orgId 的权限记录
              const orgPermissionRecords = await ResourcePermissions.find({
                orgId: { $exists: true, $ne: null },
                resourceType: 'app'
              }).lean();
              
              
              if (orgPermissionRecords.length > 0) {
                // 3.2 查询这些 orgId 对应的部门信息
                const orgIds = [...new Set(orgPermissionRecords.filter(p => p.orgId).map(p => p.orgId))];
                const teamOrgs = await TeamOrgs.find({
                  _id: { $in: orgIds }
                }).select('_id pathId').lean();
                
                // 3.3 构建 orgId -> pathId 的映射
                const orgIdToPathId = {};
                teamOrgs.forEach(org => {
                  if (org._id) {
                    orgIdToPathId[org._id.toString()] = org.pathId;
                  }
                });
                
                // 3.4 检查用户部门是否匹配
                orgPermissionRecords.forEach(perm => {
                  if (perm.orgId && perm.resourceId) {
                    const pathId = orgIdToPathId[perm.orgId.toString()];
                    if (pathId && userDepartmentCode.includes(pathId)) {
                      // 用户部门编码包含部门 pathId，表示用户在此部门或子部门
                      departmentAppIds.push(perm.resourceId);
                    }
                  }
                });
                
                departmentAppIds = [...new Set(departmentAppIds)];
              }
            }
            
            // 4. 提取用户/团队权限的应用 ID  
            let permissionAppIds = [];
            if (permissionRecords.length > 0) {
              permissionAppIds = [...new Set(permissionRecords.map(perm => perm.resourceId))];
            }
            
            // 5. 查询用户直接创建的应用
            const memberIds = teamMemberRecords.map(member => member._id);
            let directAppIds = [];
            if (memberIds.length > 0) {
              const directApps = await Apps.find({
                tmbId: { $in: memberIds }
              }).select('_id name').lean();
              
              directAppIds = directApps.map(app => app._id);
            }
            
            // 6. 合并三种方式获得的应用 ID（取并集）
            const combinedAppIds = [...new Set([...permissionAppIds, ...directAppIds, ...departmentAppIds])];
            
            if (combinedAppIds.length > 0) {
              allowedAppIds = combinedAppIds;
            } else {
              allowedAppIds = [];
            }
          } else {
            allowedAppIds = [];
          }
        }
      } catch (permError) {
        logger.error('[by-category] 权限过滤失败:', permError);
        allowedAppIds = null; // 失败时不过滤
      }
    } else {
    }
    // ========== 权限过滤逻辑结束 ==========

    // 构建查询条件 - 使用新分类系统
    const AppCategory = require('../models/AppCategory');
    let filteredAppIds = [];
    
    // 根据分类过滤应用ID（使用新分类系统）
    if (category && category !== 'all') {
      filteredAppIds = await AppCategory.getAppIdsByCategory(category, {
        sort: { updatedAt: -1 }
      });
      
      logger.debug(`[by-category] 分类 ${category} 包含 ${filteredAppIds.length} 个应用`);
      
      // 注意：即使该分类没有普通应用，也不提前返回，因为可能有外链应用
    }
    
    // 构建应用查询条件
    const query = {};
    
    if (category !== 'all') {
      logger.debug(`[by-category] 仅分类过滤: ${filteredAppIds.length} 个应用`);
      if (filteredAppIds.length > 0) {
        query._id = { $in: filteredAppIds };
      } else {
        query._id = { $in: [] };
      }
    }
    
    // 搜索逻辑
    if (search) {
      logger.debug(`[by-category] 搜索关键词: ${search}`);
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { intro: { $regex: search, $options: 'i' } }
      ];
    }

    // 分页参数
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    let apps, total;

    // 所有分类（包括"全部"）都需要支持置顶逻辑
    // 1. 获取置顶应用ID列表
    const pinnedAppCategories = await AppCategory.find({ isPinned: true })
      .sort({ pinnedAt: -1 }) // 按置顶时间降序排序，最新置顶的在最前面
      .select('appId')
      .lean();
    
    const pinnedIds = pinnedAppCategories.filter(p => p.appId).map(p => p.appId.toString());
    
    // 2. 构建置顶和非置顶应用的查询条件
    let pinnedQuery = { ...query };
    let regularQuery = { ...query };
    
    const scopedAppIds = Array.isArray(query._id?.$in)
      ? query._id.$in.map(id => id.toString())
      : null;
    if (pinnedIds.length > 0) {
      if (scopedAppIds !== null) {
        const pinnedIdSet = new Set(pinnedIds);
        const allowedPinnedIds = scopedAppIds.filter(id => pinnedIdSet.has(id));
        pinnedQuery._id = { $in: allowedPinnedIds };
        regularQuery._id = { $in: scopedAppIds.filter(id => !pinnedIdSet.has(id)) };
      } else {
        pinnedQuery._id = { $in: pinnedIds };
        regularQuery._id = { $nin: pinnedIds };
      }
    } else {
      pinnedQuery._id = { $in: [] };
    }
    
    // 3. 分别查询置顶和非置顶应用
    const [pinnedApps, regularApps] = await Promise.all([
      Apps.find(pinnedQuery)
        .select('_id name type updateTime createdAt updatedAt teamId tmbId parentId folderId parentAppId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
        .lean(),
      Apps.find(regularQuery)
        .select('_id name type updateTime createdAt updatedAt teamId tmbId parentId folderId parentAppId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
        .lean()
    ]);
    
    // 4. 按置顶时间顺序排列置顶应用
    const sortedPinnedApps = pinnedIds
      .map(id => pinnedApps.find(app => app._id.toString() === id))
      .filter(app => app); // 过滤掉未找到的应用
    
    // 5. 合并应用列表：置顶应用在前
    apps = [...sortedPinnedApps, ...regularApps];
    total = await Apps.countDocuments(query);
    
    
    // ========== 合并外链应用逻辑开始 ==========
    // 查询外链应用并合并到结果中
    if (userInfo && userInfo.Badge) {
      try {
        const linkApps = await getLinkAppsWithAccess(
          userInfo.Badge, 
          userInfo.DepartmentCode,
          category === 'all' ? null : category,
          search // 传递搜索参数
        );
      
      if (linkApps.length > 0) {
        
        // 为外链应用添加标识，并转换为普通应用格式
        const formattedLinkApps = linkApps.map(linkApp => ({
          _id: linkApp._id,
          teamId: linkApp.teamId,
          tmbId: linkApp.tmbId,
          name: linkApp.name,
          type: linkApp.type,
          version: linkApp.version,
          avatar: linkApp.avatar, // 外链应用的头像是完整URL，不需要拼接
          intro: linkApp.intro,
          newType: linkApp.newType,
          tags: linkApp.tags || [],
          isPinned: linkApp.isPinned || false,
          pinnedAt: linkApp.pinnedAt || null,
          chatCount: linkApp.chatCount || 0,
          userCount: linkApp.userCount || 0,
          favoriteCount: linkApp.favoriteCount || 0,
          hotScore: linkApp.hotScore || 0,
          category: linkApp.type, // 映射 type 为 category
          appUrl: linkApp.canAccess ? linkApp.appUrl : null,
          isLinkApp: true, // 标识这是外链应用
          canAccess: linkApp.canAccess === true,
          creator: linkApp.creator, // 外链应用已有创建人信息
          createdAt: linkApp.createdAt,
          updatedAt: linkApp.updatedAt,
          updateTime: linkApp.updatedAt // 为了排序一致性，添加 updateTime 字段
        }));
        
        // 外链应用已有 creator 字段，不需要再调用 attachCreatorInfo
        
        // 合并到应用列表
        apps = apps.concat(formattedLinkApps);
        total += linkApps.length;
        
      }
      } catch (linkAppError) {
        logger.error('[by-category] 查询外链应用失败:', linkAppError);
        // 不影响主流程，继续返回普通应用
      }
    } else {
    }
    // ========== 合并外链应用逻辑结束 ==========
    
    // ========== 过滤私有应用逻辑开始 ==========
    if (apps.length > 0) {
      // 复用权限过滤阶段已解析的当前用户 tmbId，避免重复鉴权与重复查询 team_members
      // 身份缺失时同样复用原判定，保留团队和其他个人的共享授权。

      // 只查询普通应用的权限记录（外链应用已在 getLinkAppsWithPermission 中过滤）
      const regularApps = apps.filter(app => !app.isLinkApp);
      const regularAppIds = regularApps.map(app => app._id);
      
      if (regularAppIds.length > 0) {
        const ResourcePermissions = require('../models/ResourcePermissions');
        const permissionRecords = await ResourcePermissions.find({
          resourceId: { $in: regularAppIds },
          resourceType: 'app'
        }).lean();
        const permissionsByAppId = new Map();
        permissionRecords.forEach((permission) => {
          const resourceId = permission?.resourceId?.toString();
          if (!resourceId) return;
          const appPermissions = permissionsByAppId.get(resourceId) || [];
          appPermissions.push(permission);
          permissionsByAppId.set(resourceId, appPermissions);
        });
        
        // 分析每个普通应用的权限情况，过滤私有应用
        const privateAppIds = new Set();
        
        for (const app of regularApps) {
          const appId = app._id.toString();
          const appPermissions = permissionsByAppId.get(appId) || [];
          
          // 判断是否为私有应用
          const isPrivateApp = isPrivateApplication(app, appPermissions, currentUserTmbIds);
          
          if (isPrivateApp) {
            privateAppIds.add(appId);
          }
        }
        
        // 过滤掉私有应用
        if (privateAppIds.size > 0) {
          apps = apps.filter(app => !privateAppIds.has(app._id.toString()));
          total = total - privateAppIds.size;
        }
      }
    }
    // ========== 过滤私有应用逻辑结束 ==========
    
    // 为应用添加 newType、tags 字段
    if (apps.length > 0) {
      // 只查询非外链应用的分类信息（外链应用已有 newType）
      const regularApps = apps.filter(app => !app.isLinkApp);
      const regularAppIds = regularApps.map(app => app._id.toString());
      
      let categoryMap = {};
      if (regularAppIds.length > 0) {
        categoryMap = await AppCategory.getCategoriesByAppIds(regularAppIds);
      }
      
      // 添加日志：显示每个应用的分类信息
      apps.forEach(app => {
        if (app.isLinkApp) {
        } else {
          const cat = categoryMap[app._id.toString()];
        }
      });
      
      apps.forEach(app => {
        if (app.isLinkApp) {
          // 外链应用已有 newType、tags 等字段，不需要查询
          return;
        }
        
        // 普通应用需要从 app_categories 查询
        const cat = categoryMap[app._id.toString()];
        if (cat) {
          app.newType = cat.newType;
          app.tags = cat.tags;
          app.isPinned = cat.isPinned === true;
          app.pinnedAt = cat.pinnedAt || null;
        } else {
          // 如果找不到分类信息，使用应用自身的 type 字段
          app.newType = app.type || '未分类';
          app.tags = [];
          app.isPinned = false;
          app.pinnedAt = null;
        }
      });
    }

    // Resolve visibility and ordering before expensive card statistics. The old
    // flow aggregated 1.6M chat logs for every application and only then kept
    // the requested 20 records.
    if (apps.length > 0) {
      await attachApplicationAccessPermission(apps, userInfo);
      apps = filterVisiblePlazaApps(apps);

      apps.sort((a, b) => {
        const pinnedDiff = Number(b.isPinned === true) - Number(a.isPinned === true);
        if (pinnedDiff !== 0) return pinnedDiff;

        if (a.isPinned === true && b.isPinned === true) {
          const pinnedTimeA = new Date(a.pinnedAt || 0).getTime();
          const pinnedTimeB = new Date(b.pinnedAt || 0).getTime();
          if (pinnedTimeB !== pinnedTimeA) return pinnedTimeB - pinnedTimeA;
        }

        const accessDiff = Number(b.canAccess === true) - Number(a.canAccess === true);
        if (accessDiff !== 0) return accessDiff;

        if (sortBy === 'createdAt') {
          const timeA = a.updateTime || a.updatedAt || a.createdAt || 0;
          const timeB = b.updateTime || b.updatedAt || b.createdAt || 0;
          return new Date(timeB).getTime() - new Date(timeA).getTime();
        }

        const hotScoreDiff = Number(b.hotScore || 0) - Number(a.hotScore || 0);
        if (hotScoreDiff !== 0) return hotScoreDiff;

        const timeA = a.updateTime || a.updatedAt || a.createdAt || 0;
        const timeB = b.updateTime || b.updatedAt || b.createdAt || 0;
        return new Date(timeB).getTime() - new Date(timeA).getTime();
      });

      total = apps.length;
      apps = apps.slice(skip, skip + limitNum);
    }

    // 添加 chatCount、userCount 和实时收藏数统计
    if (apps.length > 0) {
      // 只统计普通应用（外链应用已有统计数据）
      const regularApps = apps.filter(app => !app.isLinkApp);
      const regularAppIds = regularApps.map(app => app._id);
      
      if (regularAppIds.length > 0) {
        
        // 并行查询聊天统计和收藏统计
        const [chatStats, collectStats] = await Promise.all([
          // 聊天统计
          appChatStats.getStats(regularAppIds),
          // 收藏统计
          Collect.aggregate([
            { $match: { appId: { $in: regularAppIds } } },
            {
              $group: {
                _id: '$appId',
                favoriteCount: { $sum: 1 }
              }
            }
          ])
        ]);
        
        const chatStatsMap = new Map();
        chatStats.forEach(stat => {
          if (stat._id) {
            chatStatsMap.set(stat._id.toString(), {
              chatCount: stat.chatCount,
              userCount: stat.userCount
            });
          }
        });
        
        const collectStatsMap = new Map();
        collectStats.forEach(stat => {
          if (stat._id) {
            collectStatsMap.set(stat._id.toString(), stat.favoriteCount);
          }
        });
        
        // 为每个普通应用添加统计数据和类别映射
        apps.forEach(app => {
          if (app.isLinkApp) {
            // 外链应用已有统计数据，不需要查询，只添加 category 映射
            app.category = app.type;
            return;
          }
          
          const stats = chatStatsMap.get(app._id.toString());
          app.chatCount = stats?.chatCount || 0;
          app.userCount = stats?.userCount || 0;
          // 使用实时统计的收藏数，覆盖数据库中的值
          app.favoriteCount = collectStatsMap.get(app._id.toString()) || 0;
          // 将 type 字段映射为 category 方便前端使用
          app.category = app.type;
        });
      } else {
        // 只有外链应用，只需添加 category 映射
        apps.forEach(app => {
          app.category = app.type;
        });
      }
      
      // 为每个应用附加创建人信息（Badge, Name）
      await attachCreatorInfo(apps);
      
      // 附加收藏状态（如果用户已登录）
      if (userInfo && userInfo.employeeNumber) {
        try {
          const Users = require('../models/Users');
          const user = await Users.findOne({ username: userInfo.employeeNumber });
          if (user) {
            // 查询用户收藏的所有应用ID
            const userCollects = await Collect.find({ userId: user._id }).select('appId appType').lean();
            const collectedAppIds = new Set(
              userCollects
                .filter(c => c.appId) // 过滤掉 appId 为 null 或 undefined 的记录
                .map(c => c.appId.toString())
            );
            
            // 标记收藏状态
            apps.forEach(app => {
              app.isCollected = collectedAppIds.has(app._id.toString());
              app.collectCount = app.favoriteCount || 0;
            });
          }
        } catch (err) {
          logger.error('[by-category] 查询收藏状态失败:', err);
          // 不影响主流程，继续返回数据
        }
      }
    }

    await attachWecomBotConfigurationPermission(apps, userInfo);

    res.json({
      success: true,
      data: apps,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/apps-new/hot-recommend
 * @desc    获取热门推荐应用（包含置顶逻辑）
 * @access  Private (需要登录)
 * @query   {string} search - 搜索关键词 (可选)
 * @query   {string} sortBy - 排序方式 (hotScore | createdAt, 默认 hotScore)
 * @query   {number} page - 页码 (默认 1)
 * @query   {number} limit - 每页数量 (默认 20)
 */
router.get('/apps-new/hot-recommend', requirePlazaSession, async (req, res, next) => {
  try {
    const {
      search = '',
      sortBy = 'hotScore',
      page = 1,
      limit = 20
    } = req.query;

    const userInfo = res.locals.plazaUser;

    // ========== 权限过滤逻辑 ==========
    let allowedAppIds = null;
    // 复用下方权限过滤阶段解析出的当前用户 tmbId，供私有应用过滤使用
    let currentUserTmbIds = [];

    if (userInfo) {
      try {
        if (userInfo.employeeNumber) {
          const TeamMembers = require('../models/TeamMembers');
          const ResourcePermissions = require('../models/ResourcePermissions');
          const TeamOrgs = require('../models/TeamOrgs');
          
          const employeeNumber = userInfo.employeeNumber;
          const userDepartmentCode = userInfo.DepartmentCode;
          
          const teamMemberRecords = await TeamMembers.find({ name: employeeNumber }).lean();
          currentUserTmbIds = teamMemberRecords.map(member => member._id.toString());

          if (teamMemberRecords.length > 0 || userDepartmentCode) {
            // 查询用户权限和团队权限
            const permissionQueries = [];
            
            teamMemberRecords.forEach(member => {
              permissionQueries.push({
                tmbId: member._id,
                teamId: member.teamId,
                resourceType: 'app'
              });
              permissionQueries.push({
                teamId: member.teamId,
                tmbId: { $in: [null, undefined] },
                resourceType: 'app'
              });
            });
            
            const permissionRecords = permissionQueries.length > 0
              ? await ResourcePermissions.find({ $or: permissionQueries }).lean()
              : [];
            
            
            // 查询部门权限
            let departmentAppIds = [];
            if (userDepartmentCode) {
              const orgPermissionRecords = await ResourcePermissions.find({
                orgId: { $exists: true, $ne: null },
                resourceType: 'app'
              }).lean();
              
              if (orgPermissionRecords.length > 0) {
                const orgIds = [...new Set(orgPermissionRecords.filter(p => p.orgId).map(p => p.orgId))];
                const teamOrgs = await TeamOrgs.find({
                  _id: { $in: orgIds }
                }).select('_id pathId').lean();
                
                const orgIdToPathId = {};
                teamOrgs.forEach(org => {
                  if (org._id) {
                    orgIdToPathId[org._id.toString()] = org.pathId;
                  }
                });
                
                orgPermissionRecords.forEach(perm => {
                  if (perm.orgId && perm.resourceId) {
                    const pathId = orgIdToPathId[perm.orgId.toString()];
                    if (pathId && userDepartmentCode.includes(pathId)) {
                      departmentAppIds.push(perm.resourceId);
                    }
                  }
                });
                
                departmentAppIds = [...new Set(departmentAppIds)];
              }
            }
            
            let permissionAppIds = [];
            if (permissionRecords.length > 0) {
              permissionAppIds = [...new Set(permissionRecords.filter(perm => perm.resourceId).map(perm => perm.resourceId))];
            }
            
            const memberIds = teamMemberRecords.filter(member => member._id).map(member => member._id);
            let directAppIds = [];
            if (memberIds.length > 0) {
              const directApps = await Apps.find({
                tmbId: { $in: memberIds }
              }).select('_id').lean();
              
              directAppIds = directApps.map(app => app._id);
            }
            
            const combinedAppIds = [...new Set([...permissionAppIds, ...directAppIds, ...departmentAppIds])];
            
            if (combinedAppIds.length > 0) {
              allowedAppIds = combinedAppIds;
            } else {
              allowedAppIds = [];
            }
          } else {
            allowedAppIds = [];
          }
        }
      } catch (permError) {
        logger.error('[hot-recommend] 权限过滤失败:', permError);
        allowedAppIds = null;
      }
    }
    // ========== 权限过滤逻辑结束 ==========

    const AppCategory = require('../models/AppCategory');

    
    // 1. 获取所有置顶应用的ID
    const pinnedAppCategories = await AppCategory.find({ isPinned: true })
      .sort({ pinnedAt: 1 })
      .select('appId')
      .lean();
    
    const pinnedIds = pinnedAppCategories.filter(p => p.appId).map(p => p.appId.toString());
    
    // 2. 构建全量查询条件，置顶和非置顶分别取数。
    let pinnedQuery = pinnedIds.length > 0 ? { _id: { $in: pinnedIds } } : { _id: { $in: [] } };
    let hotQuery = { _id: { $nin: pinnedIds } };

    // 添加搜索条件
    if (search) {
      const searchCondition = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { intro: { $regex: search, $options: 'i' } }
        ]
      };
      
      if (pinnedQuery._id && pinnedQuery._id.$in.length > 0) {
        pinnedQuery = { $and: [pinnedQuery, searchCondition] };
      } else {
        pinnedQuery = { $and: [{ _id: { $in: [] } }, searchCondition] };
      }
      
      if (hotQuery._id) {
        hotQuery = { $and: [hotQuery, searchCondition] };
      } else {
        hotQuery = searchCondition;
      }
    }


    // 3. 分页处理
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    let pinnedApps = [];
    let hotApps = [];
    
    if (skip === 0) {
      // 第一页：获取所有置顶应用
      if (pinnedQuery._id && pinnedQuery._id.$in && pinnedQuery._id.$in.length > 0) {
        const pinnedAppsRaw = await Apps.find(pinnedQuery)
          .select('_id name type updateTime createdAt updatedAt teamId tmbId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
          .lean();
        
        const pinnedIdOrder = pinnedIds.map(id => id.toString());
        pinnedApps = pinnedAppsRaw.sort((a, b) => {
          const indexA = pinnedIdOrder.indexOf(a._id.toString());
          const indexB = pinnedIdOrder.indexOf(b._id.toString());
          return indexA - indexB;
        });
        
      }
      
      // 获取所有非置顶的热门应用（不限制数量，后续会在添加统计数据后排序）
      hotApps = await Apps.find(hotQuery)
        .select('_id name type updateTime createdAt updatedAt teamId tmbId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
        .lean();
    } else {
      // 后续页：获取所有热门应用（不限制数量，后续会排序和分页）
      hotApps = await Apps.find(hotQuery)
        .select('_id name type updateTime createdAt updatedAt teamId tmbId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
        .lean();
    }
    
    // 合并结果
    let apps = [...pinnedApps, ...hotApps];
    
    // 计算总数
    const [pinnedTotal, hotTotal] = await Promise.all([
      Apps.countDocuments(pinnedQuery),
      Apps.countDocuments(hotQuery)
    ]);
    let total = pinnedTotal + hotTotal;
    
    // ========== 合并外链应用逻辑开始 ==========
    // 查询外链应用并合并到结果中
    if (userInfo && userInfo.Badge) {
      try {
        const linkApps = await getLinkAppsWithAccess(
          userInfo.Badge, 
          userInfo.DepartmentCode,
          null, // 热门推荐不限制分类
          search // 传递搜索参数
        );
      
      if (linkApps.length > 0) {
        
        // 为外链应用添加标识，并转换为普通应用格式
        const formattedLinkApps = linkApps.map(linkApp => ({
          _id: linkApp._id,
          teamId: linkApp.teamId,
          tmbId: linkApp.tmbId,
          name: linkApp.name,
          type: linkApp.type,
          version: linkApp.version,
          avatar: linkApp.avatar, // 外链应用的头像是完整URL，不需要拼接
          intro: linkApp.intro,
          newType: linkApp.newType,
          tags: linkApp.tags || [],
          isPinned: linkApp.isPinned || false,
          pinnedAt: linkApp.pinnedAt || null,
          chatCount: linkApp.chatCount || 0,
          userCount: linkApp.userCount || 0,
          favoriteCount: linkApp.favoriteCount || 0,
          hotScore: linkApp.hotScore || 0,
          category: linkApp.type, // 映射 type 为 category
          appUrl: linkApp.canAccess ? linkApp.appUrl : null,
          isLinkApp: true, // 标识这是外链应用
          canAccess: linkApp.canAccess === true,
          creator: linkApp.creator, // 外链应用已有创建人信息
          createdAt: linkApp.createdAt,
          updatedAt: linkApp.updatedAt
        }));
        
        // 外链应用已有 creator 字段，不需要再调用 attachCreatorInfo
        
        // 区分置顶和非置顶的外链应用
        const pinnedLinkApps = formattedLinkApps.filter(app => app.isPinned);
        const hotLinkApps = formattedLinkApps.filter(app => !app.isPinned);
        
        // 合并应用（暂不排序，等待添加统计数据后再排序）
        if (skip === 0) {
          // 第一页：合并所有热门应用
          apps = [...pinnedApps, ...pinnedLinkApps, ...hotApps, ...hotLinkApps];
        } else {
          // 非第一页，正常合并
          apps = [...pinnedApps, ...pinnedLinkApps, ...hotApps, ...hotLinkApps];
        }
        
        // 更新总数
        total += linkApps.length;
        
      }
      } catch (linkAppError) {
        logger.error('[hot-recommend] 查询外链应用失败:', linkAppError);
        // 不影响主流程，继续返回普通应用
      }
    } else {
    }
    // ========== 合并外链应用逻辑结束 ==========
    
    // ========== 过滤私有应用逻辑开始 ==========
    if (apps.length > 0) {
      // 复用权限过滤阶段已解析的当前用户 tmbId，避免重复鉴权与重复查询 team_members
      // 身份缺失时同样复用原判定，保留团队和其他个人的共享授权。

      // 只查询普通应用的权限记录（外链应用已在 getLinkAppsWithPermission 中过滤）
      const regularApps = apps.filter(app => !app.isLinkApp);
      const regularAppIds = regularApps.map(app => app._id);
      
      if (regularAppIds.length > 0) {
        const ResourcePermissions = require('../models/ResourcePermissions');
        const permissionRecords = await ResourcePermissions.find({
          resourceId: { $in: regularAppIds },
          resourceType: 'app'
        }).lean();
        
        // 分析每个普通应用的权限情况，过滤私有应用
        const privateAppIds = new Set();
        
        for (const app of regularApps) {
          const appId = app._id.toString();
          const appPermissions = permissionRecords.filter(p => p.resourceId.toString() === appId);
          
          // 判断是否为私有应用
          const isPrivateApp = isPrivateApplication(app, appPermissions, currentUserTmbIds);
          
          if (isPrivateApp) {
            privateAppIds.add(appId);
          }
        }
        
        // 过滤掉私有应用
        if (privateAppIds.size > 0) {
          apps = apps.filter(app => !privateAppIds.has(app._id.toString()));
          total = total - privateAppIds.size;
        }
      }
    }
    // ========== 过滤私有应用逻辑结束 ==========
    
    // 为应用添加 newType、tags 和 isPinned 字段
    if (apps.length > 0) {
      // 只查询非外链应用的分类信息（外链应用已有 newType）
      const regularApps = apps.filter(app => !app.isLinkApp);
      const regularAppIds = regularApps.map(app => app._id.toString());
      
      let categoryMap = {};
      if (regularAppIds.length > 0) {
        categoryMap = await AppCategory.getCategoriesByAppIds(regularAppIds);
      }
      
      apps.forEach(app => {
        if (app.isLinkApp) {
          // 外链应用已有 newType、tags 等字段，不需要查询
          return;
        }
        
        // 普通应用需要从 app_categories 查询
        const cat = categoryMap[app._id.toString()];
        if (cat) {
          app.newType = cat.newType;
          app.tags = cat.tags;
          app.isPinned = cat.isPinned;
          app.pinnedAt = cat.pinnedAt;
        } else {
          // 如果找不到分类信息，使用应用自身的 type 字段
          app.newType = app.type || '未分类';
          app.tags = [];
          app.isPinned = false;
          app.pinnedAt = null;
        }
      });
    }

    // 添加 chatCount、userCount 和实时收藏数统计
    if (apps.length > 0) {
      // 只统计普通应用（外链应用已有统计数据）
      const regularApps = apps.filter(app => !app.isLinkApp);
      const regularAppIds = regularApps.map(app => app._id);
      
      if (regularAppIds.length > 0) {
        
        const [chatStats, collectStats] = await Promise.all([
          appChatStats.getStats(regularAppIds),
          Collect.aggregate([
            { $match: { appId: { $in: regularAppIds } } },
            {
              $group: {
                _id: '$appId',
                favoriteCount: { $sum: 1 }
              }
            }
          ])
        ]);
        
        const chatStatsMap = new Map();
        chatStats.forEach(stat => {
          if (stat._id) {
            chatStatsMap.set(stat._id.toString(), {
              chatCount: stat.chatCount,
              userCount: stat.userCount
            });
          }
        });
        
        const collectStatsMap = new Map();
        collectStats.forEach(stat => {
          if (stat._id) {
            collectStatsMap.set(stat._id.toString(), stat.favoriteCount);
          }
        });
        
        apps.forEach(app => {
          if (app.isLinkApp) {
            // 外链应用已有统计数据，不需要查询，只添加 category 映射
            app.category = app.type;
            return;
          }
          
          const stats = chatStatsMap.get(app._id.toString());
          app.chatCount = stats?.chatCount || 0;
          app.userCount = stats?.userCount || 0;
          app.favoriteCount = collectStatsMap.get(app._id.toString()) || 0;
          app.category = app.type;
        });
      } else {
        // 只有外链应用，只需添加 category 映射
        apps.forEach(app => {
          app.category = app.type;
        });
      }
      
      // ========== 统计数据添加完成后进行排序 ==========
      await attachApplicationAccessPermission(apps, userInfo);
      apps = filterVisiblePlazaApps(apps);
      total = apps.length;

      // 需要先将置顶和非置顶应用分开
      const finalPinnedApps = apps
        .filter(app => app.isPinned)
        .sort((a, b) => {
          const accessDiff = Number(b.canAccess === true) - Number(a.canAccess === true);
          if (accessDiff !== 0) return accessDiff;

          const timeA = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
          const timeB = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
          return timeB - timeA;
        });
      const finalHotApps = apps.filter(app => !app.isPinned);
      
      // 对非置顶应用按 userCount 和 chatCount 排序
      if (sortBy === 'createdAt') {
        // 按创建时间排序
        finalHotApps.sort((a, b) => {
          const accessDiff = Number(b.canAccess === true) - Number(a.canAccess === true);
          if (accessDiff !== 0) return accessDiff;

          const timeA = a.updateTime || a.updatedAt || 0;
          const timeB = b.updateTime || b.updatedAt || 0;
          return new Date(timeB).getTime() - new Date(timeA).getTime();
        });
      } else {
        // 按热度排序：优先使用人数，其次聊天次数
        finalHotApps.sort((a, b) => {
          const accessDiff = Number(b.canAccess === true) - Number(a.canAccess === true);
          if (accessDiff !== 0) return accessDiff;

          const userCountA = a.userCount || 0;
          const userCountB = b.userCount || 0;
          
          if (userCountB !== userCountA) {
            return userCountB - userCountA;
          }
          
          const chatCountA = a.chatCount || 0;
          const chatCountB = b.chatCount || 0;
          return chatCountB - chatCountA;
        });
      }
      
      // 第一页：置顶 + 热门（根据置顶数量决定）
      // 后续页：按分页参数返回
      if (skip === 0) {
        // 第一页逻辑：
        // 如果置顶应用 >= 4个，只显示置顶应用，不加热门应用
        // 如果置顶应用 < 4个，显示所有置顶 + 补充热门应用到总数4个
        const pinnedCount = finalPinnedApps.length;
        
        if (pinnedCount >= 4) {
          // 置顶应用 >= 4个，只显示置顶应用
          apps = [...finalPinnedApps];
        } else {
          // 置顶应用 < 4个，补充热门应用到总数4个
          const needHotCount = 4 - pinnedCount;
          const limitedHotApps = finalHotApps.slice(0, needHotCount);
          apps = [...finalPinnedApps, ...limitedHotApps];
        }
      } else {
        // 后续页：跳过置顶应用，从热门应用中分页
        const pinnedCount = finalPinnedApps.length;
        const adjustedSkip = Math.max(0, skip - pinnedCount);
        apps = finalHotApps.slice(adjustedSkip, adjustedSkip + limitNum);
      }

      // 置顶规则选出本页数据后，再保证有权限卡片位于无权限卡片之前。
      apps.sort((a, b) => Number(b.canAccess === true) - Number(a.canAccess === true));

      await attachCreatorInfo(apps);
      
      // 附加收藏状态
      if (userInfo && userInfo.employeeNumber) {
        try {
          const Users = require('../models/Users');
          const user = await Users.findOne({ username: userInfo.employeeNumber });
          if (user) {
            const userCollects = await Collect.find({ userId: user._id }).select('appId appType').lean();
            const collectedAppIds = new Set(
              userCollects
                .filter(c => c.appId) // 过滤掉 appId 为 null 或 undefined 的记录
                .map(c => c.appId.toString())
            );
            
            apps.forEach(app => {
              app.isCollected = collectedAppIds.has(app._id.toString());
              app.collectCount = app.favoriteCount || 0;
            });
          }
        } catch (err) {
          logger.error('[hot-recommend] 查询收藏状态失败:', err);
        }
      }
    }

    await attachWecomBotConfigurationPermission(apps, userInfo);

    res.json({
      success: true,
      data: apps,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    logger.error('[hot-recommend] 错误:', error);
    next(error);
  }
});

/**
 * @route   GET /api/apps-new/my-created
 * @desc    获取当前用户创建的应用
 * @access  Private
 * @query   {number} limit - 返回数量 (默认 4)
 */
router.get('/apps-new/my-created', verifyToken, async (req, res, next) => {
  try {
    // 使用旧接口的逻辑 - 通过 Tracks 表查询用户创建的应用
    const employeeNumber = req.user.employeeNumber;
    const { limit = 100 } = req.query; // 默认获取100个，前端自行控制显示数量
    let userInfoForPermission = req.user;
    
    if (!employeeNumber) {
      return res.status(401).json({
        success: false,
        message: 'Employee number not found in authentication'
      });
    }

    // 查找用户的MongoDB _id
    const Users = require('../models/Users');
    const user = await Users.findOne({ username: employeeNumber });
    
    // 注意：即使用户不存在，也继续查询外链应用
    let apps = [];
    let totalCount = 0;
    
    if (!user) {
      // 用户不存在，跳过普通应用查询，直接查询外链应用
      logger.debug('[my-created] 用户不存在，跳过普通应用查询');
    } else {

      // 从Tracks表查询该用户创建应用的记录
      const Tracks = require('../models/Tracks');
      const uid = user._id.toString();
      
      const createAppTracks = await Tracks.find({
        uid: uid, 
        event: 'createApp'
      }).lean();
      
      if (createAppTracks.length === 0) {
        logger.debug('[my-created] 用户无创建记录，跳过普通应用查询');
      } else {
        // 从Tracks记录中提取应用ID
        const appIds = createAppTracks
          .filter(track => track.data && track.data.appId)
          .map(track => track.data.appId);
        
        if (appIds.length > 0) {
          // 从Apps表查询对应的应用
          apps = await Apps
            .find({ _id: { $in: appIds } })
            .sort({ updateTime: -1 })
            .limit(parseInt(limit))
            .select('_id name type updateTime createdAt updatedAt teamId tmbId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
            .lean();

          // 查询真实的总数（Apps 表中实际存在的应用数量）
          totalCount = await Apps.countDocuments({ _id: { $in: appIds } });
        }
      }
    }

    // ========== 合并外链应用逻辑开始 ==========
    // 查询用户创建的外链应用
    const AppsLink = require('../models/AppsLink');
    const { getUserInfoFromToken } = require('../utils/auth');
    
    try {
      const authHeader = req.headers.authorization || req.headers.authtoken;
      const userInfo = await getUserInfoFromToken(authHeader);
      userInfoForPermission = userInfo || userInfoForPermission;
      
      if (userInfo && userInfo.Badge) {
        // 查询创建者 Badge 匹配的外链应用（过滤已删除）
        const linkApps = await AppsLink.find({
          'creator.Badge': String(userInfo.Badge),
          isDeleted: { $ne: true }
        }).lean();
        
        
        if (linkApps.length > 0) {
          // 转换外链应用为统一格式
          const formattedLinkApps = linkApps.map(linkApp => ({
            _id: linkApp._id,
            teamId: linkApp.teamId,
            tmbId: linkApp.tmbId,
            name: linkApp.name,
            type: linkApp.type,
            version: linkApp.version,
            avatar: linkApp.avatar,
            intro: linkApp.intro,
            newType: linkApp.newType,
            tags: linkApp.tags || [],
            isPinned: false,
            pinnedAt: null,
            chatCount: linkApp.chatCount || 0,
            userCount: linkApp.userCount || 0,
            favoriteCount: linkApp.favoriteCount || 0,
            hotScore: linkApp.hotScore || 0,
            appUrl: linkApp.appUrl,
            isLinkApp: true,
            creator: linkApp.creator,
            updateTime: linkApp.updatedAt || linkApp.createdAt,
            createdAt: linkApp.createdAt,
            updatedAt: linkApp.updatedAt
          }));
          
          // 合并到应用列表
          apps = apps.concat(formattedLinkApps);
          totalCount += linkApps.length;
          
        }
      }
    } catch (linkAppError) {
      logger.error('[my-created] 查询外链应用失败:', linkAppError);
      // 不影响主流程，继续返回普通应用
    }
    // ========== 合并外链应用逻辑结束 ==========

    // 为应用添加 newType 和 tags 字段（只处理普通应用，外链应用已有这些字段）
    if (apps.length > 0) {
      const regularApps = apps.filter(app => !app.isLinkApp);
      
      if (regularApps.length > 0) {
        const AppCategory = require('../models/AppCategory');
        const appIdStrings = regularApps.map(app => app._id.toString());
        const categoryMap = await AppCategory.getCategoriesByAppIds(appIdStrings);
        
        regularApps.forEach(app => {
          const cat = categoryMap[app._id.toString()];
          if (cat) {
            app.newType = cat.newType;
            app.tags = cat.tags;
          } else {
            // 如果找不到分类信息，使用应用自身的 type 字段
            app.newType = app.type || '未分类';
            app.tags = [];
          }
          // 我的创建不显示置顶标记
          app.isPinned = false;
          app.pinnedAt = null;
        });
      }
    }

    // 添加 chatCount、userCount 和实时收藏数统计
    if (apps.length > 0) {
      // 只统计普通应用（外链应用已有统计数据）
      const regularApps = apps.filter(app => !app.isLinkApp);
      const agentIds = regularApps.map(app => app._id);
      
      if (agentIds.length > 0) {
        
        // 并行查询聊天统计和收藏统计
        const [chatStats, collectStats] = await Promise.all([
          // 聊天统计
          appChatStats.getStats(agentIds),
          // 收藏统计
          Collect.aggregate([
            { $match: { appId: { $in: agentIds } } },
            {
              $group: {
                _id: '$appId',
                favoriteCount: { $sum: 1 }
              }
            }
          ])
        ]);
        
        const chatStatsMap = new Map();
        chatStats.forEach(stat => {
          if (stat._id) {
            chatStatsMap.set(stat._id.toString(), {
              chatCount: stat.chatCount,
              userCount: stat.userCount
            });
          }
        });
        
        const collectStatsMap = new Map();
        collectStats.forEach(stat => {
          if (stat._id) {
            collectStatsMap.set(stat._id.toString(), stat.favoriteCount);
          }
        });
        
        // 为每个普通应用添加统计数据
        regularApps.forEach(app => {
          const stats = chatStatsMap.get(app._id.toString());
          app.chatCount = stats?.chatCount || 0;
          app.userCount = stats?.userCount || 0;
          // 使用实时统计的收藏数，覆盖数据库中的值
          app.favoriteCount = collectStatsMap.get(app._id.toString()) || 0;
        });
      }

      // 附加创建人信息（会自动跳过外链应用）
      await attachCreatorInfo(apps);
      
      // 按更新时间排序（最新的在前面）
      apps.sort((a, b) => {
        const timeA = a.updateTime || a.updatedAt || a.createdAt || 0;
        const timeB = b.updateTime || b.updatedAt || b.createdAt || 0;
        return new Date(timeB) - new Date(timeA);
      });
    }

    await attachWecomBotConfigurationPermission(apps, userInfoForPermission);

    res.json({
      success: true,
      data: apps,
      total: totalCount // 返回真实的总数
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/apps-new/my-collected
 * @desc    获取当前用户收藏的应用
 * @access  Private
 * @query   {number} limit - 返回数量 (默认 4)
 */
router.get('/apps-new/my-collected', verifyToken, async (req, res, next) => {
  try {
    // 使用旧接口的逻辑
    const employeeNumber = req.user.employeeNumber;
    const { limit = 4 } = req.query;
    let userInfoForPermission = req.user;
    
    if (!employeeNumber) {
      return res.status(401).json({
        success: false,
        message: 'Employee number not found in authentication'
      });
    }

    // 查找用户的MongoDB _id
    const Users = require('../models/Users');
    try {
      const { getUserInfoFromToken } = require('../utils/auth');
      const authHeader = req.headers.authorization || req.headers.authtoken;
      const userInfo = await getUserInfoFromToken(authHeader);
      userInfoForPermission = userInfo || userInfoForPermission;
    } catch (err) {
      logger.error('[my-collected] 获取完整用户信息失败:', err);
    }

    const user = await Users.findOne({ username: employeeNumber });
    
    let apps = [];
    let collects = []; // 提升到外层作用域
    
    if (!user) {
      logger.debug('[my-collected] 用户不存在');
      // 不提前返回，继续处理
    } else {
      // 查询用户收藏记录（包含普通应用和外链应用）
      collects = await Collect.find({ userId: user._id })
        .sort({ createTime: -1 })
        .limit(parseInt(limit))
        .lean();

      if (collects.length === 0) {
        logger.debug('[my-collected] 用户无收藏记录');
        // 不提前返回，继续处理
      } else {
        // 分离普通应用和外链应用的收藏记录
        const fastgptCollects = collects.filter(c => c.appType === 'fastgpt' && c.appId);
        const linkCollects = collects.filter(c => c.appType === 'link' && c.appId);

        // 查询普通应用详情
        if (fastgptCollects.length > 0) {
          const fastgptAppIds = fastgptCollects.map(c => c.appId);
          const fastgptApps = await Apps.find({ _id: { $in: fastgptAppIds } })
            .select('_id name type updateTime createdAt updatedAt teamId tmbId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
            .lean();
          
          // 标记为普通应用
          fastgptApps.forEach(app => {
            app.isLinkApp = false;
          });
          
          apps = apps.concat(fastgptApps);
        }

        // 查询外链应用详情
        if (linkCollects.length > 0) {
          const AppsLink = require('../models/AppsLink');
          const linkAppIds = linkCollects.map(c => c.appId);
          const linkApps = await AppsLink.find({ 
            _id: { $in: linkAppIds },
            isDeleted: { $ne: true }
          })
            .select('_id name newType tags appUrl intro avatar creator favoriteCount chatCount userCount createTime updateTime')
            .lean();
          
          // 标记为外链应用
          linkApps.forEach(app => {
            app.isLinkApp = true;
            app.type = app.newType; // 兼容字段
          });
          
          apps = apps.concat(linkApps);
        }
      }
    }

    if (apps.length === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0
      });
    }

    // 为普通应用添加 newType 和 tags 字段，以及统计数据
    const regularApps = apps.filter(app => !app.isLinkApp);
    if (regularApps.length > 0) {
      // 添加 newType 和 tags
      const AppCategory = require('../models/AppCategory');
      const appIdStrings = regularApps.map(app => app._id.toString());
      const categoryMap = await AppCategory.getCategoriesByAppIds(appIdStrings);
      regularApps.forEach(app => {
        const cat = categoryMap[app._id.toString()];
        if (cat) {
          app.newType = cat.newType;
          app.tags = cat.tags;
        } else {
          // 如果找不到分类信息，使用应用自身的 type 字段
          app.newType = app.type || '未分类';
          app.tags = [];
        }
        // 我的收藏不显示置顶标记
        app.isPinned = false;
        app.pinnedAt = null;
      });
      
      // 添加 chatCount、userCount 和实时收藏数统计
      const agentIds = regularApps.map(app => app._id);
      
      // 并行查询聊天统计和收藏统计
      const [chatStats, collectStats] = await Promise.all([
        // 聊天统计
        appChatStats.getStats(agentIds),
        // 收藏统计（只统计 FastGPT 应用）
        Collect.aggregate([
          { $match: { appId: { $in: agentIds }, appType: 'fastgpt' } },
          {
            $group: {
              _id: '$appId',
              favoriteCount: { $sum: 1 }
            }
          }
        ])
      ]);
      
      const chatStatsMap = new Map();
      chatStats.forEach(stat => {
        if (stat._id) {
          chatStatsMap.set(stat._id.toString(), {
            chatCount: stat.chatCount,
            userCount: stat.userCount
          });
        }
      });
      
      const collectStatsMap = new Map();
      collectStats.forEach(stat => {
        if (stat._id) {
          collectStatsMap.set(stat._id.toString(), stat.favoriteCount);
        }
      });
      
      // 为每个普通应用添加统计数据
      regularApps.forEach(app => {
        const stats = chatStatsMap.get(app._id.toString());
        app.chatCount = stats?.chatCount || 0;
        app.userCount = stats?.userCount || 0;
        // 使用实时统计的收藏数，覆盖数据库中的值
        app.favoriteCount = collectStatsMap.get(app._id.toString()) || 0;
      });
    }

    // 为所有应用附加创建人信息和收藏状态
    if (apps.length > 0) {
      await attachCreatorInfo(apps);
      
      // 标记所有应用为已收藏（因为这是"我的收藏"接口）
      apps.forEach(app => {
        app.isCollected = true;
        app.collectCount = app.favoriteCount || 0;
      });
    }

    // 按收藏时间排序
    const appsMap = new Map(apps.map(app => [app._id.toString(), app]));
    const sortedApps = collects
      .filter(c => c.appId) // 过滤掉 appId 为 null 或 undefined 的记录
      .map(c => appsMap.get(c.appId.toString()))
      .filter(app => app !== undefined);

    await attachWecomBotConfigurationPermission(sortedApps, userInfoForPermission);

    res.json({
      success: true,
      data: sortedApps,
      total: sortedApps.length
    });
  } catch (error) {
    next(error);
  }
});

// NOTE: Previously there was a POST /api/apps-new/:appId/view route here to increment
// view counts. This endpoint was removed because it's no longer used by the client
// and keeping it caused unnecessary write traffic. If view metrics are required in
// the future, reintroduce a server-side telemetry pipeline or a bulk update job.

/**
 * @route   GET /api/categories
 * @desc    获取分类列表（使用新分类系统）
 * @access  Public
 */
router.get('/categories', async (req, res, next) => {
  try {
    const AppCategory = require('../models/AppCategory');
    
    // 定义分类列表（使用新的分类系统）
    const categories = [
      { id: 'all', name: '推荐', icon: '⭐' },
      { id: '大市场', name: '大市场', icon: '🏪' },
      { id: '财经类', name: '财经类', icon: '💰' },
      { id: '办公类', name: '办公类', icon: '📄' },
      { id: '行政类', name: '行政类', icon: '👥' },
      { id: '研发类', name: '研发类', icon: '💻' },
      { id: '综合类', name: '综合类', icon: '📋' }
    ];

    // 获取各分类应用数量（从 app_categories 表）
    const stats = await AppCategory.getStatsByCategory();
    
    const statsMap = new Map(stats.map(s => [s.category, s.count]));
    
    // 获取总数
    const totalCount = await AppCategory.countDocuments();

    const categoriesWithCount = categories.map(cat => ({
      ...cat,
      count: cat.id === 'all' 
        ? totalCount
        : statsMap.get(cat.id) || 0
    }));

    res.json({
      code: 200,
      success: true,
      data: categoriesWithCount
    });
  } catch (error) {
    logger.error('[categories] 错误:', error);
    next(error);
  }
});

/**
 * @route   GET /api/categories/:categoryId/apps
 * @desc    获取指定分类下的应用列表（使用 by-category 接口逻辑）
 * @access  Private (需要登录)
 * @param   {string} categoryId - 分类ID
 * @query   {number} page - 页码 (默认 1)
 * @query   {number} limit - 每页数量 (默认 20)
 */
router.get('/categories/:categoryId/apps', requirePlazaSession, async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const { page = 1, limit = 20, sortBy = 'hotScore' } = req.query;

    const userInfo = res.locals.plazaUser;

    // 广场使用权由下方 attachApplicationAccessPermission 统一计算。
    // 旧 allowedAppIds 不再用于可见性过滤，避免重复读取全部权限。

    // ========== 构建查询 ==========
    const AppCategory = require('../models/AppCategory');
    let filteredAppIds = [];
    
    // 根据分类过滤应用ID
    if (categoryId !== 'all') {
      // 使用新分类系统：从 app_categories 表获取该分类的应用ID
      filteredAppIds = await AppCategory.getAppIdsByCategory(categoryId, {
        sort: { updatedAt: -1 }
      });
      
      // 注意：即使没有普通应用，也要继续查询外链应用
      // 所以不在这里提前返回空结果
    }
    
    // 构建应用查询条件
    const query = {};
    
    if (categoryId !== 'all') {
      query._id = { $in: filteredAppIds };
    }
    
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    let apps, total;

    // ========== 所有分类都需要支持置顶逻辑 ==========
    // 1. 获取置顶应用ID列表
    const pinnedAppCategories = await AppCategory.find({ isPinned: true })
      .sort({ pinnedAt: -1 }) // 按置顶时间降序排序，最新置顶的在最前面
      .select('appId pinnedAt')
      .lean();
    
    const pinnedIds = pinnedAppCategories.filter(p => p.appId).map(p => p.appId.toString());
    
    // 2. 构建置顶和非置顶应用的查询条件
    let pinnedQuery = { ...query };
    let regularQuery = { ...query };
    
    const scopedAppIds = Array.isArray(query._id?.$in)
      ? query._id.$in.map(id => id.toString())
      : null;
    if (pinnedIds.length > 0) {
      if (scopedAppIds !== null) {
        const pinnedIdSet = new Set(pinnedIds);
        pinnedQuery._id = { $in: scopedAppIds.filter(id => pinnedIdSet.has(id)) };
        regularQuery._id = { $in: scopedAppIds.filter(id => !pinnedIdSet.has(id)) };
      } else {
        pinnedQuery._id = { $in: pinnedIds };
        regularQuery._id = { $nin: pinnedIds };
      }
    } else {
      pinnedQuery._id = { $in: [] };
    }
    
    // 3. 分别查询置顶和非置顶应用
    // 列表只渲染卡片所需字段，排除 modules/edges/chatConfig 等大字段，避免全量文档传输
    const [pinnedApps, regularApps] = await Promise.all([
      Apps.find(pinnedQuery)
        .select('_id name type updateTime createdAt updatedAt teamId tmbId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
        .lean(),
      Apps.find(regularQuery)
        .select('_id name type updateTime createdAt updatedAt teamId tmbId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
        .lean()
    ]);
    
    // 4. 按置顶时间顺序排列置顶应用
    const sortedPinnedApps = pinnedIds
      .map(id => pinnedApps.find(app => app._id.toString() === id))
      .filter(app => app); // 过滤掉未找到的应用
    
    // 5. 合并应用列表：置顶应用在前
    apps = [...sortedPinnedApps, ...regularApps];
    total = apps.length;
    
    // ========== 合并外链应用逻辑开始 ==========
    // 查询外链应用并合并到结果中
    if (userInfo && userInfo.Badge) {
      try {
        const linkApps = await getLinkAppsWithAccess(
          userInfo.Badge, 
          userInfo.DepartmentCode,
          categoryId === 'all' ? null : categoryId,
          '' // 该接口暂不支持搜索
        );
      
      if (linkApps.length > 0) {
        
        // 为外链应用添加标识，并转换为普通应用格式
        const formattedLinkApps = linkApps.map(linkApp => ({
          _id: linkApp._id,
          teamId: linkApp.teamId,
          tmbId: linkApp.tmbId,
          name: linkApp.name,
          type: linkApp.type,
          version: linkApp.version,
          avatar: linkApp.avatar, // 外链应用的头像是完整URL，不需要拼接
          intro: linkApp.intro,
          newType: linkApp.newType,
          tags: linkApp.tags || [],
          isPinned: linkApp.isPinned || false, // 所有分类都显示置顶信息
          pinnedAt: linkApp.pinnedAt || null, // 所有分类都显示置顶时间
          chatCount: linkApp.chatCount || 0,
          userCount: linkApp.userCount || 0,
          favoriteCount: linkApp.favoriteCount || 0,
          hotScore: linkApp.hotScore || 0,
          category: linkApp.type, // 映射 type 为 category
          appUrl: linkApp.canAccess ? linkApp.appUrl : null,
          isLinkApp: true, // 标识这是外链应用
          canAccess: linkApp.canAccess === true,
          creator: linkApp.creator, // 外链应用已有创建人信息
          createdAt: linkApp.createdAt,
          updatedAt: linkApp.updatedAt
        }));
        
        // 合并到应用列表
        apps = apps.concat(formattedLinkApps);
        total += linkApps.length;
        
      }
      } catch (linkAppError) {
        logger.error('[categories/:categoryId/apps] 查询外链应用失败:', linkAppError);
        // 不影响主流程，继续返回普通应用
      }
    } else {
    }
    // ========== 合并外链应用逻辑结束 ==========
    
    // 排序只需要置顶信息；分类标签在分页后补充。外链应用保留自身置顶字段。
    const pinnedCategoryByAppId = new Map(pinnedAppCategories
      .filter(category => category.appId)
      .map(category => [String(category.appId), category]));
    apps.forEach(app => {
      if (app.isLinkApp) return;
      const category = pinnedCategoryByAppId.get(String(app._id));
      app.isPinned = Boolean(category);
      app.pinnedAt = category?.pinnedAt || null;
    });

    // 获取应用IDs用于统计
    if (apps.length > 0) {
      // 只统计普通应用（外链应用已有统计数据）
      const regularApps = apps.filter(app => !app.isLinkApp);
      const regularAppIds = regularApps.map(app => app._id);
      
      if (regularAppIds.length > 0) {
        // 内存中的完整计数用于最热排序的并列比较，不再查询全量收藏统计。
        const chatStats = appChatStats.getStats(regularAppIds);

        // 构建统计Map
        const chatStatsMap = new Map();
        chatStats.forEach(stat => {
          chatStatsMap.set(stat._id.toString(), {
            chatCount: stat.chatCount || 0,
            userCount: stat.userCount || 0
          });
        });
        
        // 将统计数据合并到应用对象中
        apps.forEach(app => {
          if (app.isLinkApp) {
            // 外链应用已有统计数据，跳过
            return;
          }
          
          const stats = chatStatsMap.get(app._id.toString());
          if (stats) {
            app.chatCount = stats.chatCount;
            app.userCount = stats.userCount;
          } else {
            app.chatCount = 0;
            app.userCount = 0;
          }
        });
      }

      // 权限标记必须在分页前计算，分页后的每张卡片才能展示准确状态。
      await attachApplicationAccessPermission(apps, userInfo);
      apps = filterVisiblePlazaApps(apps);

      // 排序优先级：置顶（按置顶时间） > 当前排序方式。
      // 权限只作为卡片状态展示，不干扰用户选择的“最新/最热”顺序。
      apps.sort((a, b) => {
        const pinnedDiff = Number(b.isPinned === true) - Number(a.isPinned === true);
        if (pinnedDiff !== 0) {
          return pinnedDiff;
        }

        if (a.isPinned && b.isPinned) {
          const pinnedTimeA = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
          const pinnedTimeB = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
          if (pinnedTimeB !== pinnedTimeA) {
            return pinnedTimeB - pinnedTimeA;
          }
        }

        if (sortBy === 'createdAt') {
          const timeA = a.updateTime || a.updatedAt || a.createdAt || 0;
          const timeB = b.updateTime || b.updatedAt || b.createdAt || 0;
          return new Date(timeB).getTime() - new Date(timeA).getTime();
        }

        const hotScoreA = a.hotScore || 0;
        const hotScoreB = b.hotScore || 0;
        if (hotScoreB !== hotScoreA) {
          return hotScoreB - hotScoreA;
        }

        const userCountA = a.userCount || 0;
        const userCountB = b.userCount || 0;
        if (userCountB !== userCountA) {
          return userCountB - userCountA;
        }

        const chatCountA = a.chatCount || 0;
        const chatCountB = b.chatCount || 0;
        return chatCountB - chatCountA;
      });

      total = apps.length;
      apps = apps.slice(skip, skip + limitNum);

      // 完成可见性过滤和全量排序后，只查询当前页的分类标签与收藏计数。
      const regularPageApps = apps.filter(app => !app.isLinkApp);
      const regularPageAppIds = regularPageApps.map(app => app._id);
      if (regularPageAppIds.length > 0) {
        const [categoryMap, collectStats] = await Promise.all([
          AppCategory.getCategoriesByAppIds(regularPageAppIds.map(String)),
          Collect.aggregate([
            { $match: { appId: { $in: regularPageAppIds } } },
            { $group: { _id: '$appId', favoriteCount: { $sum: 1 } } }
          ])
        ]);
        const favoriteCounts = new Map(collectStats.map(stat => [String(stat._id), stat.favoriteCount || 0]));
        regularPageApps.forEach(app => {
          const category = categoryMap[String(app._id)];
          app.newType = category?.newType || app.type || '未分类';
          app.tags = category?.tags || [];
          app.favoriteCount = favoriteCounts.get(String(app._id)) || 0;
        });
      }

      // 只为当前页补充创建人，避免分页后仍处理整类数据。
      await attachCreatorInfo(apps);
      
      // 附加收藏状态（如果用户已登录）
      if (userInfo && userInfo.employeeNumber) {
        try {
          const Users = require('../models/Users');
          const user = await Users.findOne({ username: userInfo.employeeNumber });
          if (user) {
            const userCollects = await Collect.find({ userId: user._id }).select('appId appType').lean();
            const collectedAppIds = new Set(
              userCollects
                .filter(c => c.appId) // 过滤掉 appId 为 null 或 undefined 的记录
                .map(c => c.appId.toString())
            );
            
            apps.forEach(app => {
              app.isCollected = collectedAppIds.has(app._id.toString());
              app.collectCount = app.favoriteCount || 0;
            });
          }
        } catch (err) {
          logger.error('[categories/:categoryId/apps] 查询收藏状态失败:', err);
        }
      }
    }

    await attachWecomBotConfigurationPermission(apps, userInfo);

    res.json({
      code: 200,
      success: true,
      data: apps,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    logger.error('[categories/:categoryId/apps] 错误:', error);
    next(error);
  }
});

/**
 * @route   GET /api/apps-new/by-category-mixed
 * @desc    获取混合应用列表（FastGPT + 外链应用）
 * @access  Private
 */
router.get('/apps-new/by-category-mixed', requirePlazaSession, async (req, res, next) => {
  try {
    const { category = 'all', search = '', sortBy = 'hotScore', page = 1, limit = 20 } = req.query;

    const AppsLink = require('../models/AppsLink');
    const { buildLinkAppPermissionFilter } = require('../services/permissionService');
    const userInfo = res.locals.plazaUser;
    
    // 构建查询条件
    let query = {};
    if (category && category !== 'all') {
      query.newType = category;
    }
    if (search) {
      query.$text = { $search: search };
    }
    
    // 查询 FastGPT 应用
    const fastgptApps = await AppsNew.find(query).lean();
    
    // 查询外链应用（带权限过滤）
    const linkPermissionFilter = buildLinkAppPermissionFilter(userInfo);
    const linkQuery = { ...query, ...linkPermissionFilter, isDeleted: { $ne: true } };
    const linkApps = await AppsLink.find(linkQuery).lean();
    
    // 统一数据结构
    const normalizedFastgptApps = fastgptApps.map(app => ({
      ...app,
      source: 'fastgpt',
      appUrl: null
    }));
    
    const normalizedLinkApps = linkApps.map(app => ({
      ...app,
      source: 'link'
    }));
    
    // 合并并排序
    let allApps = [...normalizedFastgptApps, ...normalizedLinkApps];
    const sortField = sortBy === 'latest' ? 'createdAt' : 'hotScore';
    allApps.sort((a, b) => {
      const aVal = a[sortField] || 0;
      const bVal = b[sortField] || 0;
      return sortBy === 'latest' ? new Date(bVal) - new Date(aVal) : bVal - aVal;
    });
    
    // 分页
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const paginatedApps = allApps.slice(skip, skip + limitNum);
    
    // 附加创建人信息
    await attachCreatorInfo(paginatedApps);
    await attachWecomBotConfigurationPermission(paginatedApps, userInfo);
    
    res.json({
      code: 200,
      success: true,
      data: {
        apps: paginatedApps,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount: allApps.length,
          totalPages: Math.ceil(allApps.length / limitNum)
        }
      }
    });
  } catch (error) {
    logger.error('[by-category-mixed] 错误:', error);
    next(error);
  }
});

/**
 * @route   GET /api/apps-new/my-created-mixed
 * @desc    获取混合"我创建的"应用
 * @access  Private
 */
router.get('/apps-new/my-created-mixed', requirePlazaSession, async (req, res, next) => {
  try {
    const AppsLink = require('../models/AppsLink');
    const userInfo = res.locals.plazaUser;
    
    // 查询 FastGPT 应用（通过 tmbId）
    const fastgptApps = await AppsNew.find({ tmbId: userInfo._id }).lean();
    
    // 查询外链应用（通过 creator.Badge）
    const linkApps = await AppsLink.find({ 
      'creator.Badge': userInfo.Badge,
      isDeleted: { $ne: true }
    }).lean();
    
    // 统一数据结构
    const normalizedFastgptApps = fastgptApps.map(app => ({ ...app, source: 'fastgpt', appUrl: null }));
    const normalizedLinkApps = linkApps.map(app => ({ ...app, source: 'link' }));
    
    const allApps = [...normalizedFastgptApps, ...normalizedLinkApps];
    await attachWecomBotConfigurationPermission(allApps, userInfo);
    
    res.json({
      code: 200,
      success: true,
      data: {
        apps: allApps,
        totalCount: allApps.length,
        fastgptCount: normalizedFastgptApps.length,
        linkCount: normalizedLinkApps.length
      }
    });
  } catch (error) {
    logger.error('[my-created-mixed] 错误:', error);
    next(error);
  }
});

/**
 * @route   GET /api/apps-new/my-collected-mixed
 * @desc    获取混合"我收藏的"应用
 * @access  Private
 */
router.get('/apps-new/my-collected-mixed', requirePlazaSession, async (req, res, next) => {
  try {
    const AppsLink = require('../models/AppsLink');
    const userInfo = res.locals.plazaUser;
    
    // 查询所有收藏记录
    const collects = await Collect.find({ userId: userInfo._id }).lean();
    
    // 分组应用 ID（过滤掉 appId 为空的记录）
    const fastgptIds = collects.filter(c => c.appType === 'fastgpt' && c.appId).map(c => c.appId);
    const linkIds = collects.filter(c => c.appType === 'link' && c.appId).map(c => c.appId);
    
    // 查询应用详情
    const fastgptApps = await AppsNew.find({ _id: { $in: fastgptIds } }).lean();
    const linkApps = await AppsLink.find({ 
      _id: { $in: linkIds },
      isDeleted: { $ne: true }
    }).lean();
    
    // 统一数据结构
    const normalizedFastgptApps = fastgptApps.map(app => ({ ...app, source: 'fastgpt', appUrl: null }));
    const normalizedLinkApps = linkApps.map(app => ({ ...app, source: 'link' }));
    
    const allApps = [...normalizedFastgptApps, ...normalizedLinkApps];
    await attachWecomBotConfigurationPermission(allApps, userInfo);
    
    res.json({
      code: 200,
      success: true,
      data: {
        apps: allApps,
        totalCount: allApps.length
      }
    });
  } catch (error) {
    logger.error('[my-collected-mixed] 错误:', error);
    next(error);
  }
});

/**
 * @route   POST /api/apps-new/sync-categories
 * @desc    同步应用分类到 app_categories 表
 * @access  Admin
 */
router.post('/apps-new/sync-categories', adminAuth, async (req, res, next) => {
  try {
    const AppCategory = require('../models/AppCategory');
    
    
    // 获取所有应用
    const apps = await Apps.find({}).select('_id type name').lean();
    
    let syncCount = 0;
    let skipCount = 0;
    const syncedApps = [];
    const skippedApps = [];
    
    // 遍历所有应用
    for (const app of apps) {
      const appId = app._id.toString();
      
      // 检查是否已存在分类记录
      const existingCategory = await AppCategory.findOne({ appId }).lean();
      
      if (existingCategory) {
        // 如果已存在，跳过
        skipCount++;
        skippedApps.push({
          appId,
          name: app.name,
          category: existingCategory.newType
        });
        continue;
      }
      
      // 确定分类：优先使用 app.type，如果不存在则使用默认值
      let newType = '办公类'; // 默认分类（新分类系统）
      
      if (app.type) {
        // 旧分类到新分类的映射
        const categoryMap = {
          '财务': '财经类',
          'IT办公类': '办公类',
          '行政人事类': '行政类',
          '大市场': '大市场'
        };
        
        // 如果是旧分类，转换为新分类
        if (categoryMap[app.type]) {
          newType = categoryMap[app.type];
        } else {
          // 检查是否已经是新分类
          const validNewTypes = ['推荐', '大市场', '财经类', '办公类', '行政类', '研发类', '综合类'];
          if (validNewTypes.includes(app.type)) {
            newType = app.type;
          } else {
            // 无效分类，使用默认值
            newType = '综合类';
          }
        }
      }
      
      // 创建分类记录
      await AppCategory.create({
        appId: appId,
        newType: newType,
        tags: [],
        isPinned: false,
        pinnedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      syncCount++;
      syncedApps.push({
        appId,
        name: app.name,
        category: newType
      });
    }
    
    
    res.json({
      code: 200,
      success: true,
      message: '应用分类同步完成',
      data: {
        total: apps.length,
        synced: syncCount,
        skipped: skipCount,
        syncedApps: syncedApps.slice(0, 10), // 只返回前10个，避免响应过大
        syncedAppsCount: syncedApps.length,
        skippedAppsCount: skippedApps.length
      }
    });
  } catch (error) {
    logger.error('[sync-categories] 同步失败:', error);
    next(error);
  }
});

// ==================== 管理员 API 接口 ====================

/**
 * @route   GET /api/apps-new/admin/apps
 * @desc    管理员查询所有应用（包含FastGPT应用和外链应用）
 * @access  Admin only
 * @query   {string} search - 搜索关键词 (可选)
 * @query   {string} category - 分类过滤 (可选)
 * @query   {string} isPinned - 置顶过滤 (可选: 'true', 'false', '')
 * @query   {string} wecomBotConfigured - 企业微信 Bot 配置筛选 (可选: 'true', 'false', '')
 * @query   {string} wecomBotStatus - 企业微信 Bot 状态筛选 (可选: 'online', 'offline', 'disabled', 'disconnected', 'connected', 'failed', 'stopped', '')
 * @query   {number} page - 页码 (默认 1)
 * @query   {number} limit - 每页数量 (默认 20)
 */
router.get('/apps-new/admin/apps', adminAuth, async (req, res, next) => {
  try {
    const {
      search = '',
      category = '',
      isPinned = '',
      wecomBotConfigured = '',
      wecomBotStatus = '',
      page = 1,
      limit = 20
    } = req.query;

    logger.info(`[admin/apps] 管理员 ${req.adminBadge} 查询应用列表, isPinned=${isPinned}`);

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // 1. 查询普通应用（从 apps 表）
    const appsQuery = {};
    if (search) {
      appsQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { intro: { $regex: search, $options: 'i' } }
      ];
    }

    let apps = await Apps.find(appsQuery)
      .select('_id name avatar intro updateTime tmbId')
      .lean();

    // 标记为FastGPT应用
    apps.forEach(app => {
      app.source = 'fastgpt';
    });

    // 2. 查询外链应用（从 apps_link 表）
    const linkAppsQuery = {};
    if (search) {
      linkAppsQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { intro: { $regex: search, $options: 'i' } }
      ];
    }
    // 过滤已删除的外链应用
    linkAppsQuery.isDeleted = { $ne: true };

    let linkApps = await AppsLink.find(linkAppsQuery)
      .select('_id name avatar intro updatedAt creator newType tags isPinned pinnedAt')
      .lean();

    // 标记为外链应用，并格式化字段
    linkApps.forEach(app => {
      app.source = 'link';
      app.isLinkApp = true;
      app.updateTime = app.updatedAt;
      // 外链应用的分类和标签已在模型中
    });

    // 3. 预处理FastGPT应用的分类、标签和置顶信息（过滤已删除的应用）
    if (apps.length > 0) {
      const AppCategory = require('../models/AppCategory');
      const appIds = apps.map(app => app._id.toString());
      const categoryMap = await AppCategory.getCategoriesByAppIds(appIds);

      // 过滤掉已删除的应用
      apps = apps.filter(app => {
        const cat = categoryMap[app._id.toString()];
        return !cat || !cat.isDeleted;
      });

      apps.forEach(app => {
        const cat = categoryMap[app._id.toString()];
        if (cat) {
          app.newType = cat.newType;
          app.tags = cat.tags || [];
          app.isPinned = cat.isPinned || false;
          app.pinnedAt = cat.pinnedAt || null;
        } else {
          app.newType = '综合类';
          app.tags = [];
          app.isPinned = false;
          app.pinnedAt = null;
        }
      });
    }

    // 4. 合并FastGPT应用（已过滤已删除）和外链应用
    let allApps = [...apps, ...linkApps];

    // 5. 应用筛选条件
    if (category) {
      allApps = allApps.filter(app => app.newType === category);
    }

    if (isPinned !== '') {
      const pinnedFilter = isPinned === 'true';
      allApps = allApps.filter(app => app.isPinned === pinnedFilter);
    }

    // 6. 附加企业微信 Bot 管理摘要，并按 Bot 配置/状态过滤
    await wecomBotAdminService.attachBotSummaries(allApps);
    allApps = wecomBotAdminService.filterByBotQuery(allApps, {
      wecomBotConfigured,
      wecomBotStatus
    });

    // 7. 排序：置顶应用优先，然后按更新时间
    allApps.sort((a, b) => {
      // 置顶优先
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      
      // 都置顶或都不置顶，按置顶时间或更新时间排序
      if (a.isPinned && b.isPinned) {
        const timeA = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
        const timeB = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
        return timeB - timeA;
      }
      
      const timeA = a.updateTime ? new Date(a.updateTime).getTime() : 0;
      const timeB = b.updateTime ? new Date(b.updateTime).getTime() : 0;
      return timeB - timeA;
    });

    // 8. 分页
    const total = allApps.length;
    const skip = (pageNum - 1) * limitNum;
    const paginatedApps = allApps.slice(skip, skip + limitNum);

    // 9. 附加创建人信息（FastGPT应用和外链应用都需要补全姓名）
    await attachCreatorInfo(paginatedApps);

    res.json({
      success: true,
      data: paginatedApps,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    logger.error('[admin/apps] 错误:', error);
    next(error);
  }
});

/**
 * @route   PUT /api/apps-new/admin/apps/:appId/category
 * @desc    管理员更新应用分类
 * @access  Admin only
 * @param   {string} appId - 应用ID
 * @body    {string} category - 新分类
 */
router.put('/apps-new/admin/apps/:appId/category', adminAuth, async (req, res, next) => {
  try {
    const { appId } = req.params;
    const { category } = req.body;

    logger.info(`[admin/apps/:appId/category] 管理员 ${req.adminBadge} 更新应用 ${appId} 分类为 ${category}`);

    // 验证分类是否有效
    const validCategories = ['推荐', '大市场', '财经类', '办公类', '行政类', '研发类', '综合类'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `无效的分类。有效分类: ${validCategories.join(', ')}`
      });
    }

    // 检查应用是否存在
    const app = await Apps.findById(appId);
    if (!app) {
      return res.status(404).json({
        success: false,
        message: '应用不存在'
      });
    }

    // 更新或创建分类记录
    const AppCategory = require('../models/AppCategory');
    const result = await AppCategory.findOneAndUpdate(
      { appId: appId },
      {
        $set: {
          newType: category,
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

    logger.info(`[admin/apps/:appId/category] 更新成功:`, result);

    res.json({
      success: true,
      message: '分类更新成功',
      data: {
        appId: appId,
        category: category,
        tags: result.tags || []
      }
    });
  } catch (error) {
    logger.error('[admin/apps/:appId/category] 错误:', error);
    next(error);
  }
});

/**
 * @route   PUT /api/apps-new/admin/apps/:appId/tags
 * @desc    管理员更新应用标签
 * @access  Admin only
 * @param   {string} appId - 应用ID
 * @body    {string[]} tags - 新标签数组（最多3个，必须包含1个核心功能标签）
 */
router.put('/apps-new/admin/apps/:appId/tags', adminAuth, async (req, res, next) => {
  try {
    const { appId } = req.params;
    const { tags } = req.body;

    logger.info(`[admin/apps/:appId/tags] 管理员 ${req.adminBadge} 更新应用 ${appId} 标签为`, tags);

    // 验证标签数组
    if (!Array.isArray(tags)) {
      return res.status(400).json({
        success: false,
        message: '标签必须是数组'
      });
    }

    // 校验：必须包含至少1个核心功能标签
    const coreFunctionTags = ['效率工具', '内容生成', '信息处理', '问题解答', '创意辅助', '对话交流', '任务执行', '知识学习'];
    const hasCoreFunctionTag = tags.some(tag => coreFunctionTags.includes(tag));
    if (tags.length > 0 && !hasCoreFunctionTag) {
      return res.status(400).json({
        success: false,
        message: '必须包含至少 1 个核心功能标签'
      });
    }

    // 检查应用是否存在
    const app = await Apps.findById(appId);
    if (!app) {
      return res.status(404).json({
        success: false,
        message: '应用不存在'
      });
    }

    // 更新或创建标签记录
    const AppCategory = require('../models/AppCategory');
    const result = await AppCategory.findOneAndUpdate(
      { appId: appId },
      {
        $set: {
          tags: tags,
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

    logger.info(`[admin/apps/:appId/tags] 更新成功:`, result);

    res.json({
      success: true,
      message: '标签更新成功',
      data: {
        appId: appId,
        category: result.newType || '综合类',
        tags: tags
      }
    });
  } catch (error) {
    logger.error('[admin/apps/:appId/tags] 错误:', error);
    next(error);
  }
});

/**
 * @route   PUT /api/apps-new/admin/apps/:appId
 * @desc    管理员批量更新应用分类、标签和置顶状态
 * @access  Admin only
 * @param   {string} appId - 应用ID
 * @body    {string} category - 新分类 (可选)
 * @body    {string[]} tags - 新标签数组 (可选)
 * @body    {boolean} isPinned - 是否置顶 (可选)
 * @body    {string} source - 应用来源 'fastgpt' 或 'link' (可选，用于确定应用类型)
 */
router.put('/apps-new/admin/apps/:appId', adminAuth, async (req, res, next) => {
  try {
    const { appId } = req.params;
    const { category, tags, isPinned, source } = req.body;

    logger.info(`[admin/apps/:appId] 管理员 ${req.adminBadge} 批量更新应用 ${appId}`, { category, tags, isPinned, source });

    // 检查应用是否存在（优先检查外链应用，然后检查FastGPT应用）
    let isLinkApp = false;
    let app = await AppsLink.findById(appId);
    if (app) {
      isLinkApp = true;
    } else {
      app = await Apps.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          message: '应用不存在'
        });
      }
    }

    // 构建更新对象
    const updateData = {
      updatedAt: new Date()
    };

    // 验证并添加分类
    if (category !== undefined && category !== null) {
      const validCategories = ['大市场', '财经类', '办公类', '行政类', '研发类', '综合类'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          success: false,
          message: `无效的分类。有效分类: ${validCategories.join(', ')}`
        });
      }
      updateData.newType = category;
    }

    // 验证并添加标签
    if (tags !== undefined && tags !== null) {
      if (!Array.isArray(tags)) {
        return res.status(400).json({
          success: false,
          message: '标签必须是数组'
        });
      }

      // 校验：必须包含至少1个核心功能标签
      const coreFunctionTags = ['效率工具', '内容生成', '信息处理', '问题解答', '创意辅助', '对话交流', '任务执行', '知识学习'];
      const hasCoreFunctionTag = tags.some(tag => coreFunctionTags.includes(tag));
      if (tags.length > 0 && !hasCoreFunctionTag) {
        return res.status(400).json({
          success: false,
          message: '必须包含至少 1 个核心功能标签'
        });
      }

      updateData.tags = tags;
    }

    // 添加置顶状态
    if (isPinned !== undefined && isPinned !== null) {
      updateData.isPinned = Boolean(isPinned);
      updateData.pinnedAt = updateData.isPinned ? new Date() : null;
    }

    // 执行更新
    let result;
    if (isLinkApp) {
      // 外链应用：直接更新AppsLink表
      result = await AppsLink.findByIdAndUpdate(
        appId,
        { $set: updateData },
        { new: true }
      );
    } else {
      // FastGPT应用：更新AppCategory表
      const AppCategory = require('../models/AppCategory');
      result = await AppCategory.findOneAndUpdate(
        { appId: appId },
        { $set: updateData },
        { upsert: true, new: true }
      );
    }

    logger.info(`[admin/apps/:appId] 更新成功:`, result);

    res.json({
      success: true,
      message: '应用信息更新成功',
      data: {
        appId: appId,
        category: result.newType || '综合类',
        tags: result.tags || [],
        isPinned: result.isPinned || false,
        source: isLinkApp ? 'link' : 'fastgpt'
      }
    });
  } catch (error) {
    logger.error('[admin/apps/:appId] 错误:', error);
    next(error);
  }
});

/**
 * @route   DELETE /api/apps-new/admin/apps/:appId
 * @desc    管理员删除应用（软删除）
 * @access  Admin only
 * @param   {string} appId - 应用ID
 */
router.delete('/apps-new/admin/apps/:appId', adminAuth, async (req, res, next) => {
  try {
    const { appId } = req.params;

    logger.info(`[admin/apps/:appId DELETE] 管理员 ${req.adminBadge} 删除应用 ${appId}`);

    // 检查应用是否存在
    let isLinkApp = false;
    let app = await AppsLink.findById(appId);
    if (app) {
      isLinkApp = true;
    } else {
      app = await Apps.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          message: '应用不存在'
        });
      }
    }

    // 执行软删除
    let result;
    const deleteData = {
      isDeleted: true,
      deletedAt: new Date(),
      updatedAt: new Date()
    };

    if (isLinkApp) {
      // 外链应用：直接更新AppsLink表
      result = await AppsLink.findByIdAndUpdate(
        appId,
        { $set: deleteData },
        { new: true }
      );
    } else {
      // FastGPT应用：更新AppCategory表
      const AppCategory = require('../models/AppCategory');
      result = await AppCategory.findOneAndUpdate(
        { appId: appId },
        { $set: deleteData },
        { upsert: true, new: true }
      );
    }

    logger.info(`[admin/apps/:appId DELETE] 删除成功:`, result);

    res.json({
      success: true,
      message: '应用删除成功',
      data: {
        appId: appId,
        isDeleted: true,
        deletedAt: deleteData.deletedAt,
        source: isLinkApp ? 'link' : 'fastgpt'
      }
    });
  } catch (error) {
    logger.error('[admin/apps/:appId DELETE] 错误:', error);
    next(error);
  }
});

/**
 * @route   PUT /api/apps-new/admin/apps/:appId/pin
 * @desc    管理员切换应用置顶状态
 * @access  Admin only
 * @param   {string} appId - 应用ID
 * @body    {boolean} isPinned - 是否置顶
 * @body    {string} source - 应用来源 'fastgpt' 或 'link' (可选)
 */
router.put('/apps-new/admin/apps/:appId/pin', adminAuth, async (req, res, next) => {
  try {
    const { appId } = req.params;
    const { isPinned, source } = req.body;

    logger.info(`[admin/apps/:appId/pin] 管理员 ${req.adminBadge} ${isPinned ? '置顶' : '取消置顶'} 应用 ${appId}`);

    // 检查应用是否存在
    let isLinkApp = false;
    let app = await AppsLink.findById(appId);
    if (app) {
      isLinkApp = true;
    } else {
      app = await Apps.findById(appId);
      if (!app) {
        return res.status(404).json({
          success: false,
          message: '应用不存在'
        });
      }
    }

    const updateData = {
      isPinned: Boolean(isPinned),
      pinnedAt: isPinned ? new Date() : null
    };

    let result;
    if (isLinkApp) {
      // 外链应用
      result = await AppsLink.findByIdAndUpdate(
        appId,
        { $set: updateData },
        { new: true }
      );
    } else {
      // FastGPT应用
      const AppCategory = require('../models/AppCategory');
      result = await AppCategory.findOneAndUpdate(
        { appId: appId },
        { $set: updateData },
        { upsert: true, new: true }
      );
    }

    res.json({
      success: true,
      message: isPinned ? '应用已置顶' : '已取消置顶',
      data: {
        appId: appId,
        isPinned: result.isPinned,
        pinnedAt: result.pinnedAt,
        source: isLinkApp ? 'link' : 'fastgpt'
      }
    });
  } catch (error) {
    logger.error('[admin/apps/:appId/pin] 错误:', error);
    next(error);
  }
});

module.exports = router;
