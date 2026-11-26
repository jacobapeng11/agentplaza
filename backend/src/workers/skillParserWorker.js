require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const connectDB = require('../config/database');
const { readIntegrationConfig } = require('../config/integrations');
const SkillImportJob = require('../models/SkillImportJob');
const { getSkillStorage } = require('../services/skillStorage');
const { startSkillParserWorker } = require('../services/skillImportQueueService');

async function start() {
  if (!readIntegrationConfig().SkillEnabled) throw new Error('Skill parser requires SKILL_ENABLED=true');
  getSkillStorage();
  await connectDB();
  await SkillImportJob.init();
  const stop = startSkillParserWorker();
  logger.info('Skill parser worker started');

  const shutdown = async () => {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await stop();
    await mongoose.disconnect();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (require.main === module) {
  start().catch(async error => {
    logger.error('Skill parser startup failed:', error.message);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}
