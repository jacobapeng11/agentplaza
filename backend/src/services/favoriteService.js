const mongoose = require('mongoose');
const Apps = require('../models/Apps');
const Collect = require('../models/Collect');

/**
 * Toggle favorite status for an agent using MongoDB transaction
 * @param {ObjectId} appId - ID of the agent to favorite/unfavorite
 * @param {ObjectId} userId - ID of the user performing the action
 * @returns {Object} - Result with app ID, favorite status and favorite count
 */
const toggleFavorite = async (appId, userId) => {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      // Check if user already favorited this agent
      const existingFavorite = await Collect.findOne({ 
        userId: mongoose.Types.ObjectId(userId), 
        appId: mongoose.Types.ObjectId(appId) 
      }).session(session);

      if (existingFavorite) {
        // Remove from favorites
        await Collect.deleteOne({ 
          _id: existingFavorite._id 
        }).session(session);

        // Decrement favorite count
        await Apps.findByIdAndUpdate(
          appId,
          { $inc: { favoriteCount: -1 } },
          { session }
        );
      } else {
        // Add to favorites
        const app = await Apps.findById(appId).session(session);
        if (!app) {
          throw new Error('Agent not found');
        }

        await Collect.create([{
          userId: mongoose.Types.ObjectId(userId),
          appId: mongoose.Types.ObjectId(appId),
          appName: app.name
        }], { session });

        // Increment favorite count
        await Apps.findByIdAndUpdate(
          appId,
          { $inc: { favoriteCount: 1 } },
          { session }
        );
      }
    });
    
    // After successful transaction, return current state
    const updatedApp = await Apps.findById(appId);
    return {
      appId: appId.toString(),
      isFavorite: !existingFavorite,
      favoriteCount: updatedApp.favoriteCount
    };
  } catch (error) {
    throw error;
  } finally {
    await session.endSession();
  }
};

/**
 * Remove favorite for an agent using MongoDB transaction
 * @param {ObjectId} appId - ID of the agent to remove from favorites
 * @param {ObjectId} userId - ID of the user performing the action
 * @returns {Object} - Result with app ID, favorite status and favorite count
 */
const removeFavorite = async (appId, userId) => {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      // Remove from favorites
      const result = await Collect.deleteOne({ 
        userId: mongoose.Types.ObjectId(userId), 
        appId: mongoose.Types.ObjectId(appId) 
      }).session(session);

      if (result.deletedCount === 0) {
        throw new Error('Favorite not found');
      }

      // Decrement favorite count
      await Apps.findByIdAndUpdate(
        appId,
        { $inc: { favoriteCount: -1 } },
        { session }
      );
    });
    
    // After successful transaction, return current state
    const updatedApp = await Apps.findById(appId);
    return {
      appId: appId.toString(),
      isFavorite: false,
      favoriteCount: updatedApp.favoriteCount
    };
  } catch (error) {
    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  toggleFavorite,
  removeFavorite
};