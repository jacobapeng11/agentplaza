const logger = require('../utils/logger');
const express = require('express');
const router = express.Router();
const UsersDetail = require('../models/UsersDetail');
const TeamOrgs = require('../models/TeamOrgs');
const { getUserInfoFromToken } = require('../utils/auth');

// 认证中间件
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.authtoken;
  
  if (!authHeader) {
    return res.status(401).json({ code: 401, success: false, message: 'Authentication required' });
  }
  
  try {
    const userInfo = await getUserInfoFromToken(authHeader);
    if (!userInfo) {
      return res.status(401).json({ code: 401, success: false, message: 'Invalid token' });
    }
    req.user = userInfo;
    next();
  } catch (error) {
    logger.error('[search] Auth error:', error);
    return res.status(401).json({ code: 401, success: false, message: 'Authentication failed' });
  }
};

/**
 * @route   GET /api/search/users
 * @desc    模糊搜索用户（工号或姓名）
 * @access  Private
 * @query   {string} keyword - 搜索关键词
 */
router.get('/users', authMiddleware, async (req, res) => {
  try {
    const { keyword } = req.query;
    
    logger.debug('[search/users] 搜索关键词:', keyword);
    
    if (!keyword || keyword.trim().length === 0) {
      return res.json({ code: 200, success: true, data: [] });
    }
    
    const searchKeyword = keyword.trim();
    const regex = new RegExp(searchKeyword, 'i');
    
    logger.debug('[search/users] 查询条件:', { regex: regex.source });
    
    // 使用聚合管道来处理 Badge 字段的类型转换
    const users = await UsersDetail.aggregate([
      {
        $addFields: {
          BadgeStr: { $toString: '$Badge' }
        }
      },
      {
        $match: {
          $or: [
            { BadgeStr: regex },
            { Name: regex }
          ]
        }
      },
      {
        $project: {
          Badge: 1,
          Name: 1,
          depiddesc: 1,
          email: 1
        }
      },
      { $limit: 10 }
    ]);
    
    logger.debug('[search/users] 查询结果数量:', users.length);
    if (users.length > 0) {
      logger.debug('[search/users] 示例数据:', users[0]);
    }
    
    const result = users.map(user => ({
      value: String(user.Badge),  // 统一转为字符串
      label: `${user.Name} (${user.Badge})`,
      badge: String(user.Badge),  // 统一转为字符串
      name: user.Name,
      dept: user.depiddesc,
      email: user.email
    }));
    
    res.json({ code: 200, success: true, data: result });
  } catch (error) {
    logger.error('[search/users] Error:', error);
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

/**
 * @route   GET /api/search/departments
 * @desc    获取部门树形结构
 * @access  Private
 * @query   {string} keyword - 可选的搜索关键词
 */
router.get('/departments', authMiddleware, async (req, res) => {
  try {
    const { keyword } = req.query;
    
    logger.debug('[search/departments] 搜索关键词:', keyword);
    
    // 构建查询条件
    const query = {};
    
    // 如果有搜索关键词，添加 name 字段的模糊搜索
    if (keyword && keyword.trim().length > 0) {
      const regex = new RegExp(keyword.trim(), 'i');
      query.name = regex;
    }
    
    logger.debug('[search/departments] 查询条件:', query);
    
    // 获取所有部门数据
    const departments = await TeamOrgs.find(query)
      .select('name pathId path')
      .sort({ path: 1 })
      .limit(1000)  // 限制最多1000条
      .lean();
    
    logger.debug('[search/departments] 查询结果数量:', departments.length);
    if (departments.length > 0) {
      logger.debug('[search/departments] 示例数据:', departments.slice(0, 2));
    }
    
    // 构建树形结构
    const tree = buildDepartmentTree(departments);
    
    logger.debug('[search/departments] 树结构根节点数:', tree.length);
    
    res.json({ code: 200, success: true, data: tree });
  } catch (error) {
    logger.error('[search/departments] Error:', error);
    res.status(500).json({ code: 500, success: false, message: error.message });
  }
});

/**
 * 构建部门树形结构
 * @param {Array} departments - 扁平化的部门列表
 * @returns {Array} 树形结构的部门列表
 */
function buildDepartmentTree(departments) {
  const map = new Map();
  const tree = [];
  
  // 第一遍：创建所有节点
  departments.forEach(dept => {
    map.set(dept.pathId, {
      value: dept.pathId,
      label: dept.name,
      pathId: dept.pathId,
      path: dept.path,
      children: []
    });
  });
  
  // 第二遍：建立父子关系
  departments.forEach(dept => {
    const node = map.get(dept.pathId);
    
    if (!dept.path || dept.path === '') {
      // 根节点
      tree.push(node);
    } else {
      // 查找父节点
      const pathParts = dept.path.split('/').filter(p => p);
      if (pathParts.length > 0) {
        const parentPathId = pathParts[pathParts.length - 1];
        const parentNode = map.get(parentPathId);
        if (parentNode) {
          parentNode.children.push(node);
        } else {
          // 如果找不到父节点，作为根节点
          tree.push(node);
        }
      } else {
        tree.push(node);
      }
    }
  });
  
  // 清理空的 children 数组
  const cleanEmptyChildren = (nodes) => {
    nodes.forEach(node => {
      if (node.children.length === 0) {
        delete node.children;
      } else {
        cleanEmptyChildren(node.children);
      }
    });
  };
  
  cleanEmptyChildren(tree);
  
  return tree;
}

module.exports = router;
