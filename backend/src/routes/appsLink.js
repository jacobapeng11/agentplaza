const logger = require('../utils/logger');
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const AppsLink = require('../models/AppsLink');
const Collect = require('../models/Collect');
const Tracks = require('../models/Tracks');
const { getUserInfoFromToken } = require('../utils/auth');
const { buildLinkAppPermissionFilter, checkUserHasAccessToLinkApp } = require('../services/permissionService');
const { uploadImage } = require('../services/minioService');

// Multer 配置（内存存储）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 jpg/png/gif 格式'));
    }
  }
});

// 认证中间件
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.authtoken;
  
  logger.debug('[appsLink] Auth header:', authHeader ? 'Present' : 'Missing');
  
  if (!authHeader) {
    return res.status(401).json({ code: 401, success: false, message: 'Authentication required' });
  }
  
  try {
    const userInfo = await getUserInfoFromToken(authHeader);
    
    logger.debug('[appsLink] User info from token:', userInfo);
    
    if (!userInfo) {
      return res.status(401).json({ 
        code: 401, 
        success: false, 
        message: 'Invalid token or session expired' 
      });
    }
    
    req.user = userInfo;
    next();
  } catch (error) {
    logger.error('[appsLink] Auth error:', error);
    return res.status(401).json({ 
      code: 401, 
      success: false, 
      message: 'Authentication failed: ' + error.message 
    });
  }
};

// 验证规则
const validateLinkApp = [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('应用名称长度为 2-50 个字符'),
  body('appUrl').isURL({ protocols: ['http', 'https'] }).withMessage('无效的应用链接'),
  body('intro').trim().isLength({ max: 500 }).withMessage('简介最多 500 个字符'),
  body('newType').notEmpty().withMessage('应用分类不能为空'),
  body('tags').optional().isArray({ max: 5 }).withMessage('标签最多 5 个'),
  body('userPermissions').optional().isArray().withMessage('人员权限必须为数组'),
  body('deptPermissions').optional().isArray().withMessage('部门权限必须为数组')
];

// POST /api/apps-link - 创建外链应用
router.post('/apps-link', authMiddleware, validateLinkApp, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ code: 400, success: false, errors: errors.array() });
  }
  
  try {
    const { name, appUrl, intro, newType, tags, avatar, userPermissions, deptPermissions } = req.body;
    const userInfo = req.user;
    
    // 确保所有Badge统一为字符串类型
    const normalizedUserPermissions = (userPermissions || []).map(p => String(p));
    
    const newApp = await AppsLink.create({
      teamId: userInfo.teamId || 'default',
      tmbId: userInfo._id,
      name,
      appUrl,
      intro,
      newType,
      tags: tags || [],
      avatar: avatar || '',
      userPermissions: normalizedUserPermissions,
      deptPermissions: deptPermissions || [],
      creator: {
        Badge: String(userInfo.Badge),  // 统一为字符串
        Name: userInfo.Name || userInfo.username
      },
      updater: {
        at: new Date(),
        by: userInfo.Name || userInfo.username
      }
    });
    
    res.status(200).json({ code: 200, success: true, data: newApp });
  } catch (error) {
    logger.error('Create link app error:', error);
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

// GET /api/apps-link - 获取外链应用列表（带权限过滤）
router.get('/apps-link', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search, sortBy = 'hot' } = req.query;
    const userInfo = req.user;
    
    // 构建查询条件
    const query = buildLinkAppPermissionFilter(userInfo);
    if (category && category !== 'all') {
      query.newType = category;
    }
    if (search) {
      query.$text = { $search: search };
    }
    
    // 排序规则
    const sort = sortBy === 'latest' ? { createdAt: -1 } : { hotScore: -1 };
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const apps = await AppsLink.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalCount = await AppsLink.countDocuments(query);
    
    res.json({
      code: 200,
      success: true,
      data: {
        apps,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    logger.error('Get link apps error:', error);
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

// GET /api/apps-link/my-created - 获取我创建的外链应用
router.get('/apps-link/my-created', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = 'latest' } = req.query;
    const userInfo = req.user;
    
    // 确保Badge统一为字符串类型
    const query = { 'creator.Badge': String(userInfo.Badge) };
    const sort = sortBy === 'hot' ? { hotScore: -1 } : { createdAt: -1 };
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const apps = await AppsLink.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalCount = await AppsLink.countDocuments(query);
    
    res.json({
      code: 200,
      success: true,
      data: { 
        apps, 
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit))
        },
        totalCount 
      }
    });
  } catch (error) {
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

// GET /api/apps-link/:id - 获取单个外链应用详情
router.get('/apps-link/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userInfo = req.user;
    
    logger.debug(`[getById] Fetching app ${id} for user ${userInfo.Badge}`);
    
    // 兼容字符串和 ObjectId，使用 _id 字段查询
    const app = await AppsLink.findOne({ _id: id }).lean();
    if (!app) {
      logger.debug(`[getById] App ${id} not found in database`);
      return res.status(404).json({ code: 404, success: false, message: 'App not found' });
    }
    
    logger.debug(`[getById] App found: ${app.name}, creator: ${app.creator?.Badge}`);
    
    // 创建者或有权限的用户可以查看
    const isCreator = app.creator?.Badge === userInfo.Badge;
    const hasAccess = isCreator || await checkUserHasAccessToLinkApp(id, userInfo);
    
    logger.debug(`[getById] Access check - isCreator: ${isCreator}, hasAccess: ${hasAccess}`);
    
    if (!hasAccess) {
      return res.status(403).json({ code: 403, success: false, message: 'Access denied' });
    }
    
    res.json({ code: 200, success: true, data: app });
  } catch (error) {
    logger.error('Get link app error:', error);
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

// PUT /api/apps-link/:id - 更新外链应用（仅创建者）
router.put('/apps-link/:id', authMiddleware, validateLinkApp, async (req, res) => {
  try {
    const { id } = req.params;
    const userInfo = req.user;
    
    // 兼容字符串和 ObjectId
    // const app = await AppsLink.findOne({ _id: id });
    const app = await AppsLink.findById(id);
    if (!app) {
      return res.status(404).json({ code: 404, success: false, message: 'App not found' });
    }
    
    // 统一转为字符串比较，兼容数字和字符串类型Badge
    if (String(app.creator.Badge) !== String(userInfo.Badge)) {
      return res.status(403).json({ code: 403, success: false, message: 'Permission denied' });
    }
    
    const updateData = req.body;
    
    // 如果更新了userPermissions，确保统一为字符串类型
    if (updateData.userPermissions) {
      updateData.userPermissions = updateData.userPermissions.map(p => String(p));
    }
    
    updateData.updater = { 
      at: new Date(), 
      by: userInfo.Name || userInfo.username 
    };
    
    // 兼容字符串和 ObjectId
    const updatedApp = await AppsLink.findOneAndUpdate(
      { _id: id }, 
      updateData, 
      { new: true }
    );
    res.json({ code: 200, success: true, data: updatedApp });
  } catch (error) {
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

// DELETE /api/apps-link/:id - 删除外链应用
router.delete('/apps-link/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userInfo = req.user;
    
    // 兼容字符串和 ObjectId
    const app = await AppsLink.findOne({ _id: id });
    if (!app) {
      return res.status(404).json({ code: 404, success: false, message: 'App not found' });
    }
    
    // 统一转为字符串比较，兼容数字和字筗串类型Badge
    if (String(app.creator.Badge) !== String(userInfo.Badge)) {
      return res.status(403).json({ code: 403, success: false, message: 'Permission denied' });
    }
    
    // 兼容字符串和 ObjectId
    await AppsLink.deleteOne({ _id: id });
    
    // 级联删除收藏记录
    await Collect.deleteMany({ appId: id, appType: 'link' });
    
    // 级联删除访问记录
    await Tracks.deleteMany({ 'data.appId': id, appType: 'link' });
    
    res.json({ code: 200, success: true, message: '应用已删除' });
  } catch (error) {
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

// POST /api/apps-link/:id/favorite - 收藏/取消收藏
router.post('/apps-link/:id/favorite', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
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
    
    const userId = user._id;
    
    const existingFavorite = await Collect.findOne({ userId, appId: id, appType: 'link' });
    
    let isFavorited = false;
    let favoriteCount = 0;
    
    if (existingFavorite) {
      // 取消收藏
      await Collect.deleteOne({ _id: existingFavorite._id });
      // 兼容字符串和 ObjectId
      await AppsLink.updateOne({ _id: id }, { $inc: { favoriteCount: -1 } });
      isFavorited = false;
      logger.debug(`用户 ${employeeNumber} (${req.user.Badge}) 取消收藏外链应用 ${id}`);
    } else {
      // 添加收藏
      await Collect.create({ userId, appId: id, appType: 'link' });
      // 兼容字符串和 ObjectId
      await AppsLink.updateOne({ _id: id }, { $inc: { favoriteCount: 1 } });
      isFavorited = true;
      logger.debug(`用户 ${employeeNumber} (${req.user.Badge}) 收藏外链应用 ${id}`);
    }
    
    // 查询更新后的收藏总数
    favoriteCount = await Collect.countDocuments({ appId: id, appType: 'link' });
    logger.debug(`外链应用 ${id} 当前收藏数: ${favoriteCount}`);
    
    res.json({ 
      code: 200, 
      success: true, 
      data: { 
        isFavorited,
        isCollected: isFavorited, // 兼容字段
        favoriteCount,
        collectCount: favoriteCount, // 兼容字段
        appId: id,
        userId
      },
      message: isFavorited ? 'Application collected successfully' : 'Application uncollected successfully'
    });
  } catch (error) {
    logger.error('切换外链应用收藏状态失败:', error);
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

// POST /api/apps-link/:id/track-visit - 记录访问
router.post('/apps-link/:id/track-visit', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userInfo = req.user;
    const userBadge = userInfo.Badge;

    // 查找应用
    const app = await AppsLink.findById(id);
    if (!app) {
      return res.status(404).json({ code: 404, success: false, message: '应用不存在' });
    }

    // 检查用户是否有权限访问 - 传入正确的参数
    const hasAccess = await checkUserHasAccessToLinkApp(id, userInfo);
    if (!hasAccess) {
      logger.error(`[trackLinkAppVisit] 用户 ${userBadge} 无权访问应用 ${id}`);
      return res.status(403).json({ code: 403, success: false, message: '无权访问此应用' });
    }

    // 增加访问次数（每次点击都计数）
    await AppsLink.findByIdAndUpdate(id, {
      $inc: { chatCount: 1 }
    });

    // 检查该用户是否已访问过此应用（使用更精确的查询）
    const existingTrack = await Tracks.findOne({
      event: 'app_click',
      uid: userBadge,
      appType: 'link',
      'data.appId': id
    });

    if (!existingTrack) {
      // 首次访问，增加访问人数
      await AppsLink.findByIdAndUpdate(id, {
        $inc: { userCount: 1 }
      });

      // 创建访问记录
      await Tracks.create({
        event: 'app_click',
        uid: userBadge,
        appType: 'link',
        data: { 
          appId: id,
          appName: app.name,
          firstVisitTime: new Date()
        }
      });
      
      logger.debug(`[trackLinkAppVisit] 用户 ${userBadge} 首次访问应用 ${id}, userCount +1`);
    } else {
      // 更新最后访问时间
      await Tracks.findByIdAndUpdate(existingTrack._id, {
        $set: {
          'data.lastVisitTime': new Date()
        }
      });
      
      logger.debug(`[trackLinkAppVisit] 用户 ${userBadge} 再次访问应用 ${id}`);
    }
    
    logger.debug(`[trackLinkAppVisit] chatCount +1 for app ${id}`);
    res.json({ code: 200, success: true });
  } catch (error) {
    logger.error('[trackLinkAppVisit] 记录访问失败:', error);
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

// POST /api/apps-link/upload-image - 上传应用图标
router.post('/apps-link/upload-image', authMiddleware, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      logger.error('[uploadImage] Multer 错误:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          code: 400, 
          success: false, 
          message: '图片大小不能超过 5MB' 
        });
      }
      return res.status(400).json({ 
        code: 400, 
        success: false, 
        message: err.message 
      });
    } else if (err) {
      logger.error('[uploadImage] 文件过滤错误:', err);
      return res.status(400).json({ 
        code: 400, 
        success: false, 
        message: err.message 
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, success: false, message: '请上传文件' });
    }
    const imageUrl = await uploadImage(req.file);
    res.json({ code: 200, success: true, data: { url: imageUrl } });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ code: status, success: false, message: error.statusCode ? error.message : '上传失败' });
  }
});

module.exports = router;
