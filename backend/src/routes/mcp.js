const express = require('express');
const { getUserInfoFromToken } = require('../utils/auth');
const { resolveAdminBadges } = require('../config/adminBadges');
const logger = require('../utils/logger');
const {
  McpDomainError,
  createMcpService,
  deleteMcpService,
  getCatalog,
  getCollectedMcpServices,
  getMyServices,
  getServiceDetail,
  previewMcpConnection,
  resyncMcpService,
  toggleMcpFavorite,
  toggleMcpPinned,
  updateMcpService
} = require('../services/mcpRegistryService');

const router = express.Router();

function sendSuccess(res, data, message = 'OK') {
  return res.status(200).json({
    code: 200,
    success: true,
    data,
    message
  });
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({
    code: statusCode,
    success: false,
    message: error.message || 'Internal server error',
    detail: error.detail || undefined,
    errorCode: error.code || 'INTERNAL_ERROR'
  });
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.authtoken;
  if (!authHeader) {
    return res.status(401).json({ code: 401, success: false, message: 'Authentication required' });
  }

  try {
    const user = await getUserInfoFromToken(authHeader);
    if (!user) {
      return res.status(401).json({ code: 401, success: false, message: 'Invalid authentication token' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ code: 401, success: false, message: 'Authentication error' });
  }
}

router.use(authMiddleware);

function requirePublisher(req, res, next) {
  if (!resolveAdminBadges().includes(req.user.Badge)) {
    return res.status(403).json({ code: 403, success: false, message: 'MCP publishing requires administrator access' });
  }
  return next();
}

router.get('/catalog', async (req, res) => {
  try {
    const items = await getCatalog(req.query, req.user);
    return sendSuccess(res, { items }, 'Catalog loaded');
  } catch (error) {
    logger.error('[mcp] get catalog failed', error.message);
    return sendError(res, error);
  }
});

router.post('/catalog/:id/favorite', async (req, res) => {
  try {
    const result = await toggleMcpFavorite(req.params.id, req.user);
    return sendSuccess(res, result, 'MCP favorite state updated');
  } catch (error) {
    logger.error('[mcp] toggle favorite failed', error.message);
    return sendError(res, error);
  }
});

router.put('/catalog/:id/pin', async (req, res) => {
  try {
    const result = await toggleMcpPinned(req.params.id, req.body || {}, req.user);
    return sendSuccess(res, result, 'MCP pinned state updated');
  } catch (error) {
    logger.error('[mcp] toggle pin failed', error.message);
    return sendError(res, error);
  }
});

router.get('/catalog/:id', async (req, res) => {
  try {
    const item = await getServiceDetail(req.params.id, req.user, { allowVisibleAccess: true, incrementView: true });
    return sendSuccess(res, item, 'Catalog detail loaded');
  } catch (error) {
    logger.error('[mcp] get catalog detail failed', error.message);
    return sendError(res, error);
  }
});

router.get('/my-created', async (req, res) => {
  try {
    const items = await getMyServices(req.query, req.user);
    return sendSuccess(res, { items }, 'My created MCP services loaded');
  } catch (error) {
    logger.error('[mcp] get my created services failed', error.message);
    return sendError(res, error);
  }
});

router.get('/my-collected', async (req, res) => {
  try {
    const items = await getCollectedMcpServices(req.query, req.user);
    return sendSuccess(res, { items }, 'My collected MCP services loaded');
  } catch (error) {
    logger.error('[mcp] get my collected services failed', error.message);
    return sendError(res, error);
  }
});

router.get('/my-services', async (req, res) => {
  try {
    const items = await getMyServices(req.query, req.user);
    return sendSuccess(res, { items }, 'My services loaded');
  } catch (error) {
    logger.error('[mcp] get my services failed', error.message);
    return sendError(res, error);
  }
});

router.post('/connection-preview', requirePublisher, async (req, res) => {
  try {
    const result = await previewMcpConnection(req.body || {});
    return sendSuccess(res, result, 'MCP connection preview completed');
  } catch (error) {
    logger.error('[mcp] preview connection failed', error.message);
    return sendError(res, error);
  }
});

router.post('/my-services', requirePublisher, async (req, res) => {
  try {
    const service = await createMcpService(req.body || {}, req.user);
    const detail = await getServiceDetail(service._id, req.user);
    return sendSuccess(res, detail, 'MCP service created');
  } catch (error) {
    logger.error('[mcp] create service failed', error.message);
    return sendError(res, error);
  }
});

router.get('/my-services/:id', async (req, res) => {
  try {
    const detail = await getServiceDetail(req.params.id, req.user);
    return sendSuccess(res, detail, 'MCP service detail loaded');
  } catch (error) {
    logger.error('[mcp] get service detail failed', error.message);
    return sendError(res, error);
  }
});

router.patch('/my-services/:id', requirePublisher, async (req, res) => {
  try {
    const service = await updateMcpService(req.params.id, req.body || {}, req.user);
    const detail = await getServiceDetail(service._id, req.user);
    return sendSuccess(res, detail, 'MCP service updated');
  } catch (error) {
    logger.error('[mcp] update service failed', error.message);
    return sendError(res, error);
  }
});

router.delete('/my-services/:id', requirePublisher, async (req, res) => {
  try {
    const result = await deleteMcpService(req.params.id, req.user);
    return sendSuccess(res, result, 'MCP service deleted');
  } catch (error) {
    logger.error('[mcp] delete service failed', error.message);
    return sendError(res, error);
  }
});
router.post('/my-services/:id/resync', requirePublisher, async (req, res) => {
  try {
    const service = await resyncMcpService(req.params.id, req.user);
    const detail = await getServiceDetail(service._id, req.user);
    return sendSuccess(res, detail, 'MCP service resynced');
  } catch (error) {
    logger.error('[mcp] resync service failed', error.message);
    return sendError(res, error);
  }
});

module.exports = router;
