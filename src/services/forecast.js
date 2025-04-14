import AdvancedMachineLearningForecastService from './AIForecastService.js';
import { ForecastCollection } from '../db/models/Forecast.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import { format, addMonths, subMonths } from 'date-fns';

// Create an instance of the forecast service
const forecastService = new AdvancedMachineLearningForecastService();

// Update forecasts whenever a transaction, goal, or balance changes
export const updateForecasts = async (userId, session = null) => {
  try {
    // First, generate quick estimates for immediate display
    const quickEstimates = await generateQuickEstimates(userId);
    
    // Update the forecast document with quick estimates and set status to in_progress
    await ForecastCollection.findOneAndUpdate(
      { userId },
      { 
        quickEstimates,
        calculationStatus: 'in_progress',
        calculationProgress: 10,
        lastUpdated: new Date()
      },
      { upsert: true, new: true, session }
    );
    
    // Then proceed with full forecast calculation
    if (session) {
      return await forecastService.updateForecasts(userId, session);
    } else {
      return await forecastService.updateForecasts(userId);
    }
  } catch (error) {
    console.error('Error updating forecasts:', error);
    throw error;
  }
};

// Generate quick estimates for immediate display
export const generateQuickEstimates = async (userId) => {
  try {
    const startTime = Date.now();
    
    // Get recent transactions for quick analysis
    const recentTransactions = await TransactionCollection.find({
      userId,
      date: { $gte: subMonths(new Date(), 3) }
    }).sort({ date: -1 });
    
    // Calculate average monthly income and expenses
    const monthlyData = {};
    
    recentTransactions.forEach(transaction => {
      const monthStr = format(transaction.date, 'yyyy-MM');
      
      if (!monthlyData[monthStr]) {
        monthlyData[monthStr] = {
          income: 0,
          expense: 0,
          count: 0
        };
      }
      
      if (transaction.type === 'income') {
        monthlyData[monthStr].income += transaction.amount;
      } else {
        monthlyData[monthStr].expense += transaction.amount;
      }
      
      monthlyData[monthStr].count++;
    });
    
    // Calculate averages
    const months = Object.keys(monthlyData);
    let totalIncome = 0;
    let totalExpense = 0;
    let totalCount = 0;
    
    months.forEach(month => {
      totalIncome += monthlyData[month].income;
      totalExpense += monthlyData[month].expense;
      totalCount += monthlyData[month].count;
    });
    
    const avgIncome = months.length > 0 ? totalIncome / months.length : 0;
    const avgExpense = months.length > 0 ? totalExpense / months.length : 0;
    
    // Calculate confidence based on data quality
    const confidence = Math.min(95, Math.max(50, 
      50 + // Base confidence
      (months.length * 10) + // More months = higher confidence
      (totalCount > 20 ? 10 : 0) + // More transactions = higher confidence
      (Math.abs(avgIncome - avgExpense) > 100 ? 10 : 0) // Clear difference between income and expense
    ));
    
    // Generate quick estimates for next 3 months
    const quickEstimates = [];
    for (let i = 1; i <= 3; i++) {
      const date = addMonths(new Date(), i);
      const monthStr = format(date, 'yyyy-MM');
      
      // Apply simple trend and seasonality factors
      const monthNumber = parseInt(format(date, 'MM'));
      const seasonalFactor = calculateSeasonalFactor(monthNumber);
      
      // Simple trend factor (slight increase over time)
      const trendFactor = 1 + (i * 0.02);
      
      // Calculate projected values with seasonal and trend adjustments
      const projectedIncome = avgIncome * seasonalFactor * trendFactor;
      const projectedExpense = avgExpense * seasonalFactor * trendFactor;
      const projectedBalance = projectedIncome - projectedExpense;
      
      quickEstimates.push({
        monthStr,
        projectedExpense,
        projectedIncome,
        projectedBalance,
        confidence: Math.max(50, confidence - (i * 5)), // Confidence decreases with time
        lastCalculated: new Date()
      });
    }
    
    console.log(`Quick estimates generated in ${Date.now() - startTime}ms`);
    return quickEstimates;
  } catch (error) {
    console.error('Error generating quick estimates:', error);
    // Return safe default values
    return [
      {
        monthStr: format(addMonths(new Date(), 1), 'yyyy-MM'),
        projectedExpense: 1000,
        projectedIncome: 1500,
        projectedBalance: 500,
        confidence: 50,
        lastCalculated: new Date()
      }
    ];
  }
};

// Helper function to calculate seasonal factors
const calculateSeasonalFactor = (monthNumber) => {
  // Simple seasonal factors based on month
  const seasonalFactors = {
    1: 1.1,  // January (post-holiday spending)
    2: 0.9,  // February
    3: 1.0,  // March
    4: 1.0,  // April
    5: 1.0,  // May
    6: 1.0,  // June
    7: 1.0,  // July
    8: 1.0,  // August
    9: 1.0,  // September
    10: 1.0, // October
    11: 1.1, // November (holiday shopping)
    12: 1.2  // December (holiday season)
  };
  
  return seasonalFactors[monthNumber] || 1.0;
};

// Cache duration constants for different forecast types
const GOAL_FORECAST_CACHE_DURATION = 60 * 60 * 1000; // 1 hour for goal forecasts
const BUDGET_FORECAST_CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours for budget forecasts
const CATEGORY_FORECAST_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours for category forecasts
const QUICK_ESTIMATE_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes for quick estimates

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
      forecast = await forecastService.updateForecasts(userId);
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
      forecast = await forecastService.updateForecasts(userId);
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

// New function to get quick estimates for immediate display
export const getQuickEstimates = async (userId) => {
  try {
    // First check if we have an existing forecast with recent quick estimates
    let forecast = await ForecastCollection.findOne({ userId });

    // If no forecast exists or quick estimates are outdated, generate new ones
    if (
      !forecast ||
      !forecast.quickEstimates ||
      forecast.quickEstimates.length === 0 ||
      Date.now() - new Date(forecast.quickEstimates[0]?.lastCalculated || 0).getTime() > QUICK_ESTIMATE_CACHE_DURATION
    ) {
      console.log('Quick estimates missing or outdated, generating new ones');
      const quickEstimates = await generateQuickEstimates(userId);
      
      // Update the forecast with new quick estimates
      forecast = await ForecastCollection.findOneAndUpdate(
        { userId },
        { quickEstimates, lastUpdated: new Date() },
        { upsert: true, new: true }
      );
    }

    return {
      quickEstimates: forecast.quickEstimates || [],
      lastUpdated: forecast.lastUpdated,
      calculationStatus: forecast.calculationStatus,
      calculationProgress: forecast.calculationProgress
    };
  } catch (error) {
    console.error('Error getting quick estimates:', error);
    throw error;
  }
};
