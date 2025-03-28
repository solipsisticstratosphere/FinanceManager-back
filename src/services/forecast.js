import AdvancedMachineLearningForecastService from './AIForecastService.js';
import { ForecastCollection } from '../db/models/Forecast.js';

// Update forecasts whenever a transaction, goal, or balance changes
export const updateForecasts = async (userId, session = null) => {
  try {
    if (session) {
      return await AdvancedMachineLearningForecastService.updateForecasts(userId, session);
    } else {
      return await AdvancedMachineLearningForecastService.updateForecasts(userId);
    }
  } catch (error) {
    console.error('Error updating forecasts:', error);
    throw error;
  }
};

// Cache duration constants for different forecast types
const GOAL_FORECAST_CACHE_DURATION = 60 * 60 * 1000; // 1 hour for goal forecasts
const BUDGET_FORECAST_CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours for budget forecasts
const CATEGORY_FORECAST_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours for category forecasts

export const getGoalForecasts = async (userId) => {
  try {
    // First check if we have an existing forecast
    let forecast = await ForecastCollection.findOne({ userId });

    // If no forecast exists or it's older than the cache duration, update it
    if (
      !forecast ||
      !forecast.goalForecast ||
      Date.now() - new Date(forecast.lastUpdated).getTime() > GOAL_FORECAST_CACHE_DURATION
    ) {
      console.log('Goal forecast missing or outdated, generating new forecast');
      forecast = await AdvancedMachineLearningForecastService.updateForecasts(userId);
    }

    // Return only the goal forecast portion
    if (forecast && forecast.goalForecast) {
      return {
        goalForecast: forecast.goalForecast,
        lastUpdated: forecast.lastUpdated,
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting goal forecasts:', error);
    throw error;
  }
};

export const getCategoryForecasts = async (userId, specificCategory = null) => {
  try {
    // First check if we have an existing forecast
    let forecast = await ForecastCollection.findOne({ userId });

    // If no forecast exists or it's older than the cache duration, update it
    if (
      !forecast ||
      !forecast.budgetForecasts ||
      forecast.budgetForecasts.length === 0 ||
      Date.now() - new Date(forecast.lastUpdated).getTime() > CATEGORY_FORECAST_CACHE_DURATION
    ) {
      console.log('Category forecast missing or outdated, generating new forecast');
      forecast = await AdvancedMachineLearningForecastService.updateForecasts(userId);
    }

    if (!forecast || !forecast.budgetForecasts || forecast.budgetForecasts.length === 0) {
      return null;
    }

    // Extract all category predictions from forecasts
    const categoryData = {};
    const categories = [];

    forecast.budgetForecasts.forEach((monthForecast) => {
      if (monthForecast.categoryPredictions) {
        Object.entries(monthForecast.categoryPredictions).forEach(([category, data]) => {
          // If specific category is requested, filter others
          if (specificCategory && category !== specificCategory) {
            return;
          }

          if (!categoryData[category]) {
            categoryData[category] = {
              category,
              type: data.type,
              monthlyPredictions: [],
            };
            categories.push(category);
          }

          categoryData[category].monthlyPredictions.push({
            month: monthForecast.monthStr,
            date: monthForecast.date,
            amount: data.amount,
          });
        });
      }
    });

    // Format response
    return {
      categories: Object.values(categoryData),
      lastUpdated: forecast.lastUpdated,
    };
  } catch (error) {
    console.error('Error getting category forecasts:', error);
    throw error;
  }
};
