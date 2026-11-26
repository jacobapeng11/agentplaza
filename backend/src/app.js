require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');
const { getFrontendUrl } = require('./config/frontendUrl');
const { client: redis } = require('./utils/redis');
const { readIntegrationConfig } = require('./config/integrations');
const { normalizeEncryptionKey } = require('./services/wecomBotSecretService');

function createApp() {
  const app = express();
  const { McpEnabled, WecomBotEnabled, SkillEnabled } = readIntegrationConfig();
  if (McpEnabled || WecomBotEnabled) normalizeEncryptionKey();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: getFrontendUrl() || false,
    credentials: true
  }));

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Routes
  if (WecomBotEnabled) {
    app.use('/api/apps', require('./routes/wecomBot'));
    app.use('/api/wecom-bot', require('./routes/wecomUserBinding'));
    app.use('/api/apps-new/admin', require('./routes/adminWecomBot'));
  }
  app.use('/api/apps', require('./routes/apps'));
  app.use('/api/login', require('./routes/login'));
  app.use('/api', require('./routes/appsNew'));
  app.use('/api', require('./routes/appsLink'));
  app.use('/api/search', require('./routes/search'));
  if (McpEnabled) {
    app.use('/api/mcp', require('./routes/mcp'));
  }
  if (SkillEnabled) {
    require('./services/skillStorage').getSkillStorage();
    app.use('/api/skills', require('./routes/skills'));
  }

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.status(200).json({
      code: 200,
      success: true,
      data: {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      },
      message: 'Health check successful'
    });
  });

  app.get('/api/ready', (_req, res) => {
    const data = {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      redis: redis.isReady ? 'connected' : 'disconnected'
    };
    const success = data.mongodb === 'connected' && data.redis === 'connected';
    res.status(success ? 200 : 503).json({ success, data });
  });

  // Error handling middleware
  app.use(errorHandler);

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      code: 404,
      success: false,
      message: 'Route not found'
    });
  });

  return app;
}

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
