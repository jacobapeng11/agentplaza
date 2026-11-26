const logger = require('../utils/logger');
const express = require('express');
const router = express.Router();
const favoriteService = require('../services/favoriteService');
const Apps = require('../models/Apps');
const Collect = require('../models/Collect');
const AppCategory = require('../models/AppCategory');
const { getFastgptFrontendBaseUrl } = require('../config/fastgpt');

const { getUserInfoFromToken } = require('../utils/auth');
const FASTGPT_FRONTEND_BASE_URL = getFastgptFrontendBaseUrl();

// Helper function to enrich apps with category information from app_categories table
async function enrichAppsWithCategories(apps) {
  if (!apps || apps.length === 0) {
    return apps;
  }

  // Get all app IDs
  const appIds = apps.map(app => app._id.toString());
  
  // Fetch category mappings from app_categories table
  const categories = await AppCategory.getCategoriesByAppIds(appIds);
  
  // Add newType to each app
  return apps.map(app => ({
    ...app,
    newType: categories[app._id.toString()] || '办公类' // Default category (新分类系统)
  }));
}

// Authentication middleware to verify requests have proper authentication
const authMiddleware = async (req, res, next) => {
  // Check for authentication header
  const authHeader = req.headers.authorization || req.headers.authtoken;
  
  if (!authHeader) {
    return res.status(401).json({
      code: 401,
      success: false,
      message: 'Authentication required'
    });
  }
  // Extract user information from the token (which gets it from Redis)
  getUserInfoFromToken(authHeader)
    .then(userInfo => {
      logger.debug('Authentication22222222222:', userInfo);
      if (!userInfo) {
        return res.status(401).json({
          code: 401,
          success: false,
          message: 'Invalid authentication token or session expired'
        });
      }
      
      // Add user info to the request object for use in subsequent handlers
      req.user = userInfo;
      
      // Continue to the next middleware
      next();
    })
    .catch(error => {
      logger.error('Authentication error:', error);
      return res.status(401).json({
        code: 401,
        success: false,
        message: 'Authentication error'
      });
    });
};

// Optional authentication middleware - doesn't fail if no auth
const optionalAuthMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.authtoken;
  
  if (authHeader) {
    try {
      const userInfo = await getUserInfoFromToken(authHeader);
      if (userInfo) {
        req.user = userInfo;
      }
    } catch (error) {
      logger.debug('Optional auth failed:', error.message);
      // Don't fail, just continue without user info
    }
  }
  
  next();
};

// Apply authentication middleware to all routes in this router (except specified ones if needed)
// Note: login route is in a different file, so it won't be affected by this middleware
router.use((req, res, next) => {
  // Use optional auth for /hot endpoint
  if (req.path === '/hot') {
    return optionalAuthMiddleware(req, res, next);
  }
  // Use required auth for other endpoints
  return authMiddleware(req, res, next);
});

// GET /api/apps - Get paginated list of agents with optional search, filtering, and sorting
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      keyword = '',
      type = '',
      sortBy = 'hotScore',
      order = 'desc'
    } = req.query;

    // Validate query parameters
    const validSortFields = ['hotScore', 'updateTime', 'name', 'favoriteCount'];
    if (!validSortFields.includes(sortBy)) {
      return res.status(400).json({
        code: 400,
        success: false,
        message: 'Invalid sortBy field'
      });
    }

    const validOrder = ['asc', 'desc'];
    if (!validOrder.includes(order)) {
      return res.status(400).json({
        code: 400,
        success: false,
        message: 'Invalid order field'
      });
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    
    // Build query
    const query = {};
    
    if (keyword) {
      // Search by name using regex for partial matching
      query.name = { $regex: keyword, $options: 'i' }; // 'i' for case-insensitive
    }
    
    if (type) {
      query.type = type;
    }

    // Define sort object
    const sort = {};
    sort[sortBy] = order === 'asc' ? 1 : -1;

    // Execute query with pagination
    let agents = await Apps
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit, 10))
      .select('_id name type updateTime teamId version avatar inheritPermission likeCount favoriteCount hotScore description') // Only return necessary fields
      .lean();

    // Enrich apps with category information from app_categories table
    agents = await enrichAppsWithCategories(agents);

    // Get total count for pagination
    const total = await Apps.countDocuments(query);

    res.status(200).json({
      code: 200,
      success: true,
      data: {
        agents,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          totalPages: Math.ceil(total / parseInt(limit, 10))
        }
      },
      message: 'Agents retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      success: false,
      message: error.message
    });
  }
});

// GET /api/apps/user/:type - Get user-specific agents (从authentication获取用户信息)
router.get('/user/:type', async (req, res) => {
  try {
    const { type } = req.params; // 'created' or 'frequent'
    const { 
      page = 1, 
      limit = 20, 
      keyword = '' // Add keyword search parameter
    } = req.query;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    
    // 从authentication middleware获取用户信息
    const employeeNumber = req.user.employeeNumber;
    
    if (!employeeNumber) {
      return res.status(401).json({
        code: 401,
        success: false,
        message: 'Employee number not found in authentication'
      });
    }
    
    logger.debug('获取用户智能体，员工工号:', employeeNumber, '类型:', type);
    
    // 查找用户的MongoDB _id
    const Users = require('../models/Users');
    const user = await Users.findOne({ username: employeeNumber });
    
    if (!user) {
      return res.status(200).json({
        code: 302,
        success: false,
        data: {
          redirectUrl: FASTGPT_FRONTEND_BASE_URL
        },
        message: 'User not found in database, please redirect to registration'
      });
    }
    
    let agents = [];
    let total = 0;

    if (type === 'created') {
      // 根据用户需求，通过Tracks表查询用户创建的应用
      const Tracks = require('../models/Tracks');
      let uid = user._id.toString()
      // 1. 从Tracks表查询该用户创建应用的记录
      logger.debug(`查询用户 ${employeeNumber} 的创建记录，用户ID类型:`, typeof user._id, user._id);
      const createAppTracks = await Tracks.find({
        uid: uid, 
        event: 'createApp'
      }).lean();
      
      logger.debug(`用户 ${employeeNumber} 的创建应用记录数量:`, createAppTracks.length);
      
      if (createAppTracks.length === 0) {
        // 如果没有创建记录，返回空结果
        agents = [];
        total = 0;
      } else {
        // 2. 从Tracks记录中提取应用ID
        const appIds = createAppTracks
          .filter(track => track.data && track.data.appId)
          .map(track => track.data.appId);
        
        logger.debug(`提取到的应用ID数量:`, appIds.length);
        
        if (appIds.length === 0) {
          agents = [];
          total = 0;
        } else {
          // 3. 构建查询条件
          let query = { _id: { $in: appIds } };
          
          // Add keyword search if provided
          if (keyword) {
            query.name = { $regex: keyword, $options: 'i' }; // 'i' for case-insensitive
          }
          
          // 4. 从Apps表查询对应的应用
          agents = await Apps
            .find(query)
            .sort({ updateTime: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .select('_id name type updateTime teamId tmbId version avatar inheritPermission likeCount favoriteCount hotScore description intro') // Only return necessary fields
            .lean();
          
          // Enrich apps with category information from app_categories table
          agents = await enrichAppsWithCategories(agents);
          
          total = await Apps.countDocuments(query);
          
          // 5. 为应用添加 chatCount 统计
          if (agents.length > 0) {
            const agentIds = agents.map(agent => agent._id);
            
            // 查询这些应用的聊天统计
            const AppChatLogs = require('../models/AppChatLogs');
            const chatStats = await AppChatLogs.aggregate([
              {
                $match: {
                  appId: { $in: agentIds }
                }
              },
              {
                $group: {
                  _id: '$appId',
                  chatCount: { $sum: 1 },
                  userCount: { $addToSet: '$userId' } // 收集所有不同的用户ID
                }
              },
              {
                $project: {
                  _id: 1,
                  chatCount: 1,
                  userCount: { $size: '$userCount' } // 计算不同用户的数量
                }
              }
            ]);
            
            // 创建聊天统计映射
            const chatStatsMap = new Map();
            chatStats.forEach(stat => {
              if (stat._id) {
                chatStatsMap.set(stat._id.toString(), {
                  chatCount: stat.chatCount,
                  userCount: stat.userCount
                });
              }
            });
            
            // 为每个应用添加 chatCount 和 userCount
            agents = agents.map(agent => ({
              ...agent,
              chatCount: chatStatsMap.get(agent._id.toString())?.chatCount || 0,
              userCount: chatStatsMap.get(agent._id.toString())?.userCount || 0
            }));
          }
        }
      }
      
      logger.debug(`用户 ${employeeNumber} 创建的智能体数量:`, total);
    }
    // For 'frequent' agents, we would get from Chats collection
    else if (type === 'frequent') {
      // 这里将来可以从Chats集合查询常用智能体
      agents = []; // In a real app, this would query the Chats collection
      total = 0;
      logger.debug(`用户 ${employeeNumber} 常用的智能体数量:`, total);
    } else {
      return res.status(400).json({
        code: 400,
        success: false,
        message: 'Invalid type parameter. Use "created" or "frequent"'
      });
    }

    res.status(200).json({
      code: 200,
      success: true,
      data: {
        agents,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          totalPages: Math.ceil(total / parseInt(limit, 10))
        }
      },
      message: type === 'created' ? 'User created agents retrieved successfully' : 'User frequent agents retrieved successfully'
    });
  } catch (error) {
    logger.error('获取用户智能体失败:', error);
    res.status(500).json({
      code: 500,
      success: false,
      message: error.message
    });
  }
});

// GET /api/apps/frequent - Get frequently used agents for authenticated user
router.get('/frequent', async (req, res) => {
  try {
    const { limit = 3, keyword = '' } = req.query;
    
    // 从authentication middleware获取用户信息
    const employeeNumber = req.user.employeeNumber;
    
    if (!employeeNumber) {
      return res.status(401).json({
        code: 401,
        success: false,
        message: 'Employee number not found in authentication'
      });
    }
    
    logger.debug('获取常用智能体，员工工号:', employeeNumber);
    
    // 查找用户的MongoDB _id
    const Users = require('../models/Users');
    const user = await Users.findOne({ username: employeeNumber });
    
    if (!user) {
      return res.status(200).json({
        code: 302,
        success: false,
        data: {
          redirectUrl: FASTGPT_FRONTEND_BASE_URL
        },
        message: 'User not found in database, please redirect to registration'
      });
    }

    // 实现真正的常用智能体查询逻辑
    // 1. 从 app_chat_logs 表中查询该用户的聊天记录，按 appId 分组统计使用次数
    const AppChatLogs = require('../models/AppChatLogs');
    
    // 构建匹配条件：查询该用户的聊天记录
    const chatMatchQuery = {
      // 根据提供的数据结构，使用 userId 字段匹配
      userId: user._id.toString()
    };
    
    // 聚合查询：按 appId 分组，统计使用次数，并按使用频率排序
    const frequentAppsStats = await AppChatLogs.aggregate([
      {
        $match: chatMatchQuery
      },
      {
        $group: {
          _id: '$appId',
          chatCount: { $sum: 1 },
          lastUsedTime: { $max: '$createTime' }
        }
      },
      {
        $sort: { chatCount: -1, lastUsedTime: -1 } // 按使用次数和最后使用时间排序
      },
      {
        $limit: parseInt(limit, 10) * 2 // 获取更多数据以备筛选
      }
    ]);
    
    logger.debug(`用户 ${employeeNumber} 的聊天应用统计:`, frequentAppsStats.length);
    
    if (frequentAppsStats.length === 0) {
      agents = [];
    } else {
      // 2. 提取应用ID
      const appIds = frequentAppsStats
        .map(stat => stat._id)
        .filter(id => id); // 过滤掉空值
      
      if (appIds.length === 0) {
        agents = [];
      } else {
        // 3. 构建应用查询条件
        let appQuery = { _id: { $in: appIds } };
        
        // 添加关键词搜索
        if (keyword) {
          appQuery.name = { $regex: keyword, $options: 'i' };
        }
        
        // 4. 从 Apps 表查询应用信息
        let appsData = await Apps
          .find(appQuery)
          .select('_id name type updateTime teamId version avatar inheritPermission likeCount favoriteCount hotScore description intro')
          .lean();
        
        // Enrich apps with category information from app_categories table
        appsData = await enrichAppsWithCategories(appsData);
        
        // 5. 获取每个应用的总体使用人数统计
        const userCountStats = await AppChatLogs.aggregate([
          {
            $match: {
              appId: { $in: appIds }
            }
          },
          {
            $group: {
              _id: '$appId',
              userCount: { $addToSet: '$userId' }
            }
          },
          {
            $project: {
              _id: 1,
              userCount: { $size: '$userCount' }
            }
          }
        ]);
        
        // 创建用户数统计映射
        const userCountMap = new Map();
        userCountStats.forEach(stat => {
          if (stat._id) {
            userCountMap.set(stat._id.toString(), stat.userCount);
          }
        });
        
        // 6. 创建使用统计映射
        const statsMap = new Map();
        frequentAppsStats.forEach(stat => {
          if (stat._id) {
            statsMap.set(stat._id.toString(), {
              chatCount: stat.chatCount,
              lastUsedTime: stat.lastUsedTime
            });
          }
        });
        
        // 7. 合并应用信息和使用统计，并按使用频率排序
        agents = appsData
          .map(app => {
            const stats = statsMap.get(app._id.toString());
            return {
              ...app,
              chatCount: stats ? stats.chatCount : 0,
              lastUsedTime: stats ? stats.lastUsedTime : null,
              userCount: userCountMap.get(app._id.toString()) || 0
            };
          })
          .sort((a, b) => {
            // 按 chatCount 降序排序
            if (b.chatCount !== a.chatCount) {
              return b.chatCount - a.chatCount;
            }
            // 如果 chatCount 相同，按最后使用时间排序
            return new Date(b.lastUsedTime || 0) - new Date(a.lastUsedTime || 0);
          })
          .slice(0, parseInt(limit, 10)); // 限制返回数量
      }
    }
    
    res.status(200).json({
      code: 200,
      success: true,
      data: { agents },
      message: 'Frequently used agents retrieved successfully'
    });
  } catch (error) {
    logger.error('获取常用智能体失败:', error);
    res.status(500).json({
      code: 500,
      success: false,
      message: error.message
    });
  }
});

// POST /api/apps/:id/favorite - Toggle favorite status for an agent
router.post('/:id/favorite', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 从authentication middleware获取用户信息
    const employeeNumber = req.user.employeeNumber;
    
    if (!employeeNumber) {
      return res.status(401).json({
        code: 401,
        success: false,
        message: 'Employee number not found in authentication'
      });
    }
    
    // 查找用户的MongoDB _id
    const Users = require('../models/Users');
    const user = await Users.findOne({ username: employeeNumber });
    
    if (!user) {
      return res.status(200).json({
        code: 302,
        success: false,
        data: {
          redirectUrl: FASTGPT_FRONTEND_BASE_URL
        },
        message: 'User not found in database, please redirect to registration'
      });
    }
    
    logger.debug(`用户 ${employeeNumber} 切换智能体 ${id} 的收藏状态`);

    // Use the favorite service to handle transaction with user's MongoDB _id
    const result = await favoriteService.toggleFavorite(id, user._id);

    res.status(200).json({
      code: 200,
      success: true,
      data: result,
      message: result.isFavorite ? 'Agent favorited successfully' : 'Agent un-favorited successfully'
    });
  } catch (error) {
    logger.error('切换收藏状态失败:', error);
    res.status(500).json({
      code: 500,
      success: false,
      message: error.message
    });
  }
});

// DELETE /api/apps/:id/favorite - Remove favorite for an agent
router.delete('/:id/favorite', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 从authentication middleware获取用户信息
    const employeeNumber = req.user.employeeNumber;
    
    if (!employeeNumber) {
      return res.status(401).json({
        code: 401,
        success: false,
        message: 'Employee number not found in authentication'
      });
    }
    
    // 查找用户的MongoDB _id
    const Users = require('../models/Users');
    const user = await Users.findOne({ username: employeeNumber });
    
    if (!user) {
      return res.status(404).json({
        code: 404,
        success: false,
        message: 'User not found in database'
      });
    }
    
    logger.debug(`用户 ${employeeNumber} 取消收藏智能体 ${id}`);

    // Use the favorite service to handle transaction with user's MongoDB _id
    const result = await favoriteService.removeFavorite(id, user._id);

    res.status(200).json({
      code: 200,
      success: true,
      data: result,
      message: 'Agent un-favorited successfully'
    });
  } catch (error) {
    logger.error('取消收藏失败:', error);
    res.status(500).json({
      code: 500,
      success: false,
      message: error.message
    });
  }
});

// GET /api/apps/hot - Get agents sorted by hotScore (recent activity) combined with chat count
router.get('/hot', async (req, res) => {
  try {
    const { limit = 15, keyword = '', page = 1, category = '' } = req.query;
    const maxLimit = 50;

    const validLimit = Math.min(parseInt(limit, 10), maxLimit);
    const validPage = Math.max(parseInt(page, 10), 1);
    const skip = (validPage - 1) * validLimit;

    // ========== 权限过滤逻辑开始 ==========
    let allowedAppIds = null; // null 表示不进行权限过滤
    
    // 从authentication middleware获取用户信息（如果有的话）
    if (req.user && req.user.employeeNumber) {
      try {
        const TeamMembers = require('../models/TeamMembers');
        const ResourcePermissions = require('../models/ResourcePermissions');
        
        const employeeNumber = req.user.employeeNumber;
        logger.debug(`开始权限过滤，员工工号: ${employeeNumber}`);
        
        // 1. 通过员工工号查询 team_members 表，匹配 name 字段
        const teamMemberRecords = await TeamMembers.find({ name: employeeNumber }).lean();
        logger.debug(`找到 ${teamMemberRecords.length} 条团队成员记录`);
        
        if (teamMemberRecords.length > 0) {
          // 2. 通过团队成员记录的 _id 和 teamId 查询 resource_permissions 表
          // 查询条件分两种情况（取并集）：
          // 情况1：tmbId 匹配成员 _id 且 teamId 匹配
          // 情况2：teamId 匹配且 tmbId 为空（团队级别权限）
          const permissionQueries = [];
          
          teamMemberRecords.forEach(member => {
            // 情况1：匹配特定成员的权限（tmbId 有值且匹配）
            permissionQueries.push({
              tmbId: member._id,
              teamId: member.teamId,
              resourceType: 'app'
            });
            
            // 情况2：匹配团队级别的权限（tmbId 为空）
            permissionQueries.push({
              teamId: member.teamId,
              tmbId: { $in: [null, undefined] }, // tmbId 没有值
              resourceType: 'app'
            });
          });
          
          // 使用 $or 操作符查询所有匹配的权限记录（取并集）
          const permissionRecords = await ResourcePermissions.find({
            $or: permissionQueries
          }).lean();
          
          logger.debug(`找到 ${permissionRecords.length} 条权限记录`);
          
          // 3. 提取有权限的应用 ID（通过权限表授权的应用）
          let permissionAppIds = [];
          if (permissionRecords.length > 0) {
            permissionAppIds = [...new Set(permissionRecords.map(perm => perm.resourceId))];
            logger.debug(`通过权限表授权的应用数量: ${permissionAppIds.length}`);
          }
          
          // 4. 同时查询用户直接创建的应用（apps.tmbId 匹配团队成员 _id）
          const memberIds = teamMemberRecords.map(member => member._id);
          const directApps = await Apps.find({
            tmbId: { $in: memberIds }
          }).select('_id').lean();
          
          const directAppIds = directApps.map(app => app._id);
          logger.debug(`用户直接创建的应用数量: ${directAppIds.length}`);
          
          // 5. 合并两种方式获得的应用 ID（取并集）
          const combinedAppIds = [...new Set([...permissionAppIds, ...directAppIds])];
          
          if (combinedAppIds.length > 0) {
            allowedAppIds = combinedAppIds;
            logger.debug(`用户有权限访问的应用总数（并集）: ${allowedAppIds.length}`);
          } else {
            // 如果没有任何权限记录，返回空结果
            allowedAppIds = [];
            logger.debug('用户没有任何应用访问权限');
          }
        } else {
          // 如果不是团队成员，返回空结果
          allowedAppIds = [];
          logger.debug('用户不是任何团队的成员');
        }
      } catch (permError) {
        logger.error('权限过滤失败:', permError);
        // 权限查询失败时，不影响主流程，允许访问所有应用
        allowedAppIds = null;
      }
    } else {
      logger.debug('未登录用户，不进行权限过滤');
    }
    // ========== 权限过滤逻辑结束 ==========

    // Build query for apps collection with keyword search and permission filter
    const query = {};
    
    // 添加权限过滤条件
    if (allowedAppIds !== null) {
      if (allowedAppIds.length === 0) {
        // 如果用户没有权限访问任何应用，直接返回空结果
        return res.status(200).json({
          code: 200,
          success: true,
          data: { 
            agents: [],
            pagination: {
              page: validPage,
              limit: validLimit,
              total: 0,
              totalPages: 0
            }
          },
          message: 'No accessible agents found'
        });
      }
      // resourceId 已经是 ObjectId 类型，直接使用 $in 查询
      query._id = { $in: allowedAppIds };
    }
    
    if (keyword) {
      // Search by name using regex for partial matching
      query.name = { $regex: keyword, $options: 'i' }; // 'i' for case-insensitive
      logger.debug('Hot agents search query:', query);
    }

    if (category) {
      // Filter by category/type
      query.type = { $regex: category, $options: 'i' }; // 'i' for case-insensitive
      logger.debug('Hot agents category filter:', category);
    }

    logger.debug(`获取热门智能体，关键词: "${keyword}", 分类: "${category}", 页码: ${validPage}, 限制: ${validLimit}`);

    // Get total count for pagination
    const totalCount = await Apps.countDocuments(query);

    // First, fetch agents from the apps collection to get all app IDs
    let agents = await Apps
      .find(query)
      .sort({ hotScore: -1 }) // Descending order by hotScore
      .skip(skip)
      .limit(validLimit)
      .select('_id name type updateTime intro teamId version avatar inheritPermission likeCount favoriteCount hotScore description') // Only return necessary fields
      .lean();

    // Enrich apps with category information from app_categories table
    agents = await enrichAppsWithCategories(agents);

    // Extract app IDs for chat count lookup
    const appIds = agents.map(agent => agent._id);

    // Get chat statistics for these specific app IDs
    const AppChatLogs = require('../models/AppChatLogs');
    const chatStats = await AppChatLogs.aggregate([
      {
        $match: {
          appId: { $in: appIds } // Only match chats for the apps we found
        }
      },
      {
        $group: {
          _id: '$appId',
          chatCount: { $sum: 1 },
          lastChatTime: { $max: '$createTime' },
          userCount: { $addToSet: '$userId' } // 收集所有不同的用户ID
        }
      },
      {
        $project: {
          _id: 1,
          chatCount: 1,
          lastChatTime: 1,
          userCount: { $size: '$userCount' } // 计算不同用户的数量
        }
      },
      {
        $sort: { chatCount: -1 }
      }
    ]);

    // Create a map for quick lookup of chat statistics
    const chatStatsMap = new Map();
    chatStats.forEach(stat => {
      // Add null check for _id
      if (stat._id) {
        chatStatsMap.set(stat._id.toString(), {
          chatCount: stat.chatCount,
          lastChatTime: stat.lastChatTime,
          userCount: stat.userCount
        });
      }
    });

    // Combine agents data with chat statistics
    const agentsWithChatStats = agents.map(agent => {
      const agentId = agent._id.toString();
      const chatStat = chatStatsMap.get(agentId);
      
      return {
        ...agent,
        chatCount: chatStat ? chatStat.chatCount : 0,
        lastChatTime: chatStat ? chatStat.lastChatTime : null,
        userCount: chatStat ? chatStat.userCount : 0
      };
    });

    // Check which apps are collected by the current user and get collect counts
    const Users = require('../models/Users');
    let userCollects = [];
    let collectCounts = new Map();
    
    // Get collect counts for all agents
    const collectStats = await Collect.aggregate([
      {
        $match: {
          appId: { $in: agents.map(agent => agent._id) }
        }
      },
      {
        $group: {
          _id: '$appId',
          collectCount: { $sum: 1 }
        }
      }
    ]);
    
    // Create a map for quick lookup of collect counts
    collectStats.forEach(stat => {
      if (stat._id) {
        collectCounts.set(stat._id.toString(), stat.collectCount);
      }
    });
    
    // 从authentication middleware获取用户信息（如果有的话）
    if (req.user && req.user.employeeNumber) {
      try {
        const user = await Users.findOne({ username: req.user.employeeNumber });
        if (user) {
          const collectedApps = await Collect.find({ userId: user._id }).select('appId');
          userCollects = collectedApps
            .filter(collect => collect.appId) // 过滤掉 appId 为 null 或 undefined 的记录
            .map(collect => collect.appId.toString());
        }
      } catch (userError) {
        logger.debug('获取用户收藏信息失败:', userError.message);
        // 不影响主要功能，继续执行
      }
    }

    // Add isCollected status and collect count to each agent
    const agentsWithCollectStatus = agentsWithChatStats.map(agent => ({
      ...agent,
      isCollected: userCollects.includes(agent._id.toString()),
      collectCount: collectCounts.get(agent._id.toString()) || 0
    }));

    // Sort by chat count descending, then by hotScore
    agentsWithCollectStatus.sort((a, b) => {
      if (b.chatCount !== a.chatCount) {
        return b.chatCount - a.chatCount;
      }
      return b.hotScore - a.hotScore;
    });

    res.status(200).json({
      code: 200,
      success: true,
      data: { 
        agents: agentsWithCollectStatus,
        pagination: {
          page: validPage,
          limit: validLimit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / validLimit)
        }
      },
      message: 'Hot agents with chat statistics retrieved successfully'
    });
  } catch (error) {
    logger.error('获取热门智能体失败:', error);
    res.status(500).json({
      code: 500,
      success: false,
      message: error.message
    });
  }
});

// POST /api/apps/:id/collect - Toggle collect status for an agent (for hot agents)
router.post('/:id/collect', async (req, res) => {
  try {
    const { id } = req.params;
    const { appData } = req.body; // 前端传递的完整应用数据
    
    // 从authentication middleware获取用户信息
    const employeeNumber = req.user.employeeNumber;
    
    if (!employeeNumber) {
      return res.status(401).json({
        code: 401,
        success: false,
        message: 'Employee number not found in authentication'
      });
    }
    
    // 查找用户的MongoDB _id
    const Users = require('../models/Users');
    const user = await Users.findOne({ username: employeeNumber });
    
    if (!user) {
      return res.status(200).json({
        code: 302,
        success: false,
        data: {
          redirectUrl: FASTGPT_FRONTEND_BASE_URL
        },
        message: 'User not found in database, please redirect to registration'
      });
    }
    
    logger.debug(`用户 ${employeeNumber} 切换应用 ${id} 的收藏状态`);

    // 检查是否已经收藏（只查询 FastGPT 应用）
    const existingCollect = await Collect.findOne({
      userId: user._id,
      appId: id,
      appType: 'fastgpt'
    });

    let isCollected = false;
    let message = '';

    if (existingCollect) {
      // 如果已经收藏，则取消收藏
      await Collect.deleteOne({
        userId: user._id,
        appId: id,
        appType: 'fastgpt'
      });
      isCollected = false;
      message = 'Application uncollected successfully';
      logger.debug(`用户 ${employeeNumber} 取消收藏应用 ${id}`);
    } else {
      // 如果没有收藏，则添加收藏
      const newCollect = new Collect({
        userId: user._id,
        appId: id,
        appName: appData?.name || 'Unknown App', // 使用前端传递的应用名称
        appType: 'fastgpt' // 明确标记为 FastGPT 应用
      });
      
      await newCollect.save();
      isCollected = true;
      message = 'Application collected successfully';
      logger.debug(`用户 ${employeeNumber} 收藏应用 ${id}, 应用名称: ${appData?.name}`);
    }

    // 查询该应用的最新收藏总数（只统计 FastGPT 应用）
    const collectCount = await Collect.countDocuments({ appId: id, appType: 'fastgpt' });
    logger.debug(`应用 ${id} 当前收藏数: ${collectCount}`);

    res.status(200).json({
      code: 200,
      success: true,
      data: {
        isCollected,
        appId: id,
        userId: user._id,
        collectCount,
        favoriteCount: collectCount // 兼容字段
      },
      message
    });
  } catch (error) {
    logger.error('切换收藏状态失败:', error);
    res.status(500).json({
      code: 500,
      success: false,
      message: error.message
    });
  }
});

// GET /api/apps/collected - Get user's collected apps
router.get('/collected', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    // 从authentication middleware获取用户信息
    const employeeNumber = req.user.employeeNumber;
    
    if (!employeeNumber) {
      return res.status(401).json({
        code: 401,
        success: false,
        message: 'Employee number not found in authentication'
      });
    }
    
    // 查找用户的MongoDB _id
    const Users = require('../models/Users');
    const user = await Users.findOne({ username: employeeNumber });
    
    if (!user) {
      return res.status(200).json({
        code: 302,
        success: false,
        data: {
          redirectUrl: FASTGPT_FRONTEND_BASE_URL
        },
        message: 'User not found in database, please redirect to registration'
      });
    }
    
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    // 获取用户收藏的应用
    const collectedApps = await Collect
      .find({ userId: user._id })
      .sort({ createTime: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate('appId', '_id name type updateTime intro teamId version avatar inheritPermission likeCount favoriteCount hotScore description')
      .lean();

    // 获取总数
    const total = await Collect.countDocuments({ userId: user._id });

    // 格式化返回数据
    let apps = collectedApps
      .filter(collect => collect.appId) // 过滤掉可能已删除的应用
      .map(collect => ({
        ...collect.appId,
        collectedAt: collect.createTime
      }));

    // Enrich apps with category information from app_categories table
    apps = await enrichAppsWithCategories(apps);

    // 为收藏的应用添加 chatCount 统计
    if (apps.length > 0) {
      const appIds = apps.map(app => app._id);
      
      // 查询这些应用的聊天统计
      const AppChatLogs = require('../models/AppChatLogs');
      const chatStats = await AppChatLogs.aggregate([
        {
          $match: {
            appId: { $in: appIds }
          }
        },
        {
          $group: {
            _id: '$appId',
            chatCount: { $sum: 1 },
            userCount: { $addToSet: '$userId' }
          }
        },
        {
          $project: {
            _id: 1,
            chatCount: 1,
            userCount: { $size: '$userCount' }
          }
        }
      ]);
      
      // 创建聊天统计映射
      const chatStatsMap = new Map();
      chatStats.forEach(stat => {
        if (stat._id) {
          chatStatsMap.set(stat._id.toString(), {
            chatCount: stat.chatCount,
            userCount: stat.userCount
          });
        }
      });
      
      // 为每个应用添加 chatCount 和 userCount
      apps.forEach(app => {
        const stats = chatStatsMap.get(app._id.toString());
        app.chatCount = stats?.chatCount || 0;
        app.userCount = stats?.userCount || 0;
      });
    }

    res.status(200).json({
      code: 200,
      success: true,
      data: {
        apps,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          totalPages: Math.ceil(total / parseInt(limit, 10))
        }
      },
      message: 'Collected apps retrieved successfully'
    });
  } catch (error) {
    logger.error('获取收藏应用失败:', error);
    res.status(500).json({
      code: 500,
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
