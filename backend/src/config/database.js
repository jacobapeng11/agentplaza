const logger = require('../utils/logger');
const mongoose = require('mongoose');

async function connectDB() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  } catch (error) {
    throw new Error('MongoDB connection failed (' + error.name + ')');
  }
  logger.info('Connected to MongoDB');
}

module.exports = connectDB;
