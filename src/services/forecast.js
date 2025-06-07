import AdvancedMachineLearningForecastService from './AIForecastService.js';
import { ForecastCollection } from '../db/models/Forecast.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import { format, addMonths, subMonths } from 'date-fns';

// Create an instance of the forecast service
const forecastService = new AdvancedMachineLearningForecastService();

// Cache duration constants for different forecast types
const GOAL_FORECAST_CACHE_DURATION = 60 * 60 * 1000; // 1 hour for goal forecasts
const BUDGET_FORECAST_CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours for budget forecasts
const CATEGORY_FORECAST_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours for category forecasts
const QUICK_ESTIMATE_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes for quick estimates

// Update forecasts whenever a transaction, goal, or balance changes
export const updateForecasts = async (userId, session = null, forceUpdate = false) => {
  try {
    console.log(`Starting forecast update process for user ${userId}, forceUpdate: ${forceUpdate}`);
    const startTime = Date.now();

    // First, check if we need to update
    if (!forceUpdate) {
      const existingForecast = await ForecastCollection.findOne({ userId });

      // If we have a recent forecast and not forcing update, use the cached version
      if (existingForecast && existingForecast.lastUpdated) {
        const timeSinceLastUpdate = Date.now() - new Date(existingForecast.lastUpdated).getTime();
        if (timeSinceLastUpdate < QUICK_ESTIMATE_CACHE_DURATION) {
          console.log(`Using recent forecast from ${timeSinceLastUpdate}ms ago`);
          return existingForecast;
        }
      }
    } else {
      console.log('Forcing forecast update after transaction');
    }

    // First, generate quick estimates for immediate display
    console.log('Generating quick estimates...');
    const quickEstimates = await generateQuickEstimates(userId);

    // Generate 30-day budget forecast
    console.log('Generating 30-day budget...');
    const thirtyDayBudget = await generateThirtyDayBudget(userId);

    // Update the forecast document with quick estimates and set status to in_progress
    const initialUpdate = await ForecastCollection.findOneAndUpdate(
      { userId },
      {
        quickEstimates,
        thirtyDayBudget,
        calculationStatus: 'in_progress',
        calculationProgress: 10,
        lastUpdated: new Date(),
      },
      { upsert: true, new: true, session },
    );

    // Then proceed with full forecast calculation
    console.log('Proceeding with full forecast calculation...');
    let result;
    if (session) {
      result = await forecastService.updateForecasts(userId, session);
    } else {
      result = await forecastService.updateForecasts(userId);
    }

    console.log(`Forecast update completed in ${Date.now() - startTime}ms`);
    return result;
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
      date: { $gte: subMonths(new Date(), 3) },
    }).sort({ date: -1 });

    // Calculate average monthly income and expenses
    const monthlyData = {};

    recentTransactions.forEach((transaction) => {
      const monthStr = format(transaction.date, 'yyyy-MM');

      if (!monthlyData[monthStr]) {
        monthlyData[monthStr] = {
          income: 0,
          expense: 0,
          count: 0,
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

    months.forEach((month) => {
      totalIncome += monthlyData[month].income;
      totalExpense += monthlyData[month].expense;
      totalCount += monthlyData[month].count;
    });

    const avgIncome = months.length > 0 ? totalIncome / months.length : 0;
    const avgExpense = months.length > 0 ? totalExpense / months.length : 0;

    // Calculate confidence based on data quality
    const confidence = Math.min(
      95,
      Math.max(
        50,
        50 + // Base confidence
          months.length * 10 + // More months = higher confidence
          (totalCount > 20 ? 10 : 0) + // More transactions = higher confidence
          (Math.abs(avgIncome - avgExpense) > 100 ? 10 : 0), // Clear difference between income and expense
      ),
    );

    // Generate quick estimates for next 3 months
    const quickEstimates = [];
    for (let i = 1; i <= 3; i++) {
      const date = addMonths(new Date(), i);
      const monthStr = format(date, 'yyyy-MM');

      // Apply simple trend and seasonality factors
      const monthNumber = parseInt(format(date, 'MM'));
      const seasonalFactor = calculateSeasonalFactor(monthNumber);

      // Simple trend factor (slight increase over time)
      const trendFactor = 1 + i * 0.02;

      // Calculate projected values with seasonal and trend adjustments
      const projectedIncome = avgIncome * seasonalFactor * trendFactor;
      const projectedExpense = avgExpense * seasonalFactor * trendFactor;
      const projectedBalance = projectedIncome - projectedExpense;

      quickEstimates.push({
        monthStr,
        projectedExpense,
        projectedIncome,
        projectedBalance,
        confidence: Math.max(50, confidence - i * 5), // Confidence decreases with time
        lastCalculated: new Date(),
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
        lastCalculated: new Date(),
      },
    ];
  }
};

// Generate 30-day budget forecast
export const generateThirtyDayBudget = async (userId) => {
  try {
    const startTime = Date.now();

    // Get recent transactions for analysis
    const recentTransactions = await TransactionCollection.find({
      userId,
      date: { $gte: subMonths(new Date(), 3) },
    }).sort({ date: -1 });

    // Calculate average monthly income and expenses
    const monthlyData = {};

    recentTransactions.forEach((transaction) => {
      const monthStr = format(transaction.date, 'yyyy-MM');

      if (!monthlyData[monthStr]) {
        monthlyData[monthStr] = {
          income: 0,
          expense: 0,
          count: 0,
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

    months.forEach((month) => {
      totalIncome += monthlyData[month].income;
      totalExpense += monthlyData[month].expense;
      totalCount += monthlyData[month].count;
    });

    const avgIncome = months.length > 0 ? totalIncome / months.length : 0;
    const avgExpense = months.length > 0 ? totalExpense / months.length : 0;

    // Calculate confidence based on data quality
    const confidence = Math.min(
      95,
      Math.max(
        50,
        50 + // Base confidence
          months.length * 10 + // More months = higher confidence
          (totalCount > 20 ? 10 : 0) + // More transactions = higher confidence
          (Math.abs(avgIncome - avgExpense) > 100 ? 10 : 0), // Clear difference between income and expense
      ),
    );

    // Calculate 30-day projections (approximately 1 month)
    // Apply current month's seasonal factor
    const currentMonthNumber = parseInt(format(new Date(), 'MM'));
    const seasonalFactor = calculateSeasonalFactor(currentMonthNumber);

    // Calculate projected values with seasonal adjustment
    const projectedIncome = avgIncome * seasonalFactor;
    const projectedExpense = avgExpense * seasonalFactor;
    const projectedBalance = projectedIncome - projectedExpense;

    console.log(`30-day budget forecast generated in ${Date.now() - startTime}ms`);
    return {
      projectedExpense,
      projectedIncome,
      projectedBalance,
      confidence,
      lastCalculated: new Date(),
    };
  } catch (error) {
    console.error('Error generating 30-day budget forecast:', error);
    // Return safe default values
    return {
      projectedExpense: 1000,
      projectedIncome: 1500,
      projectedBalance: 500,
      confidence: 50,
      lastCalculated: new Date(),
    };
  }
};

// Helper function to calculate seasonal factors
const calculateSeasonalFactor = (monthNumber) => {
  // Simple seasonal factors based on month
  const seasonalFactors = {
    1: 1.1, // January (post-holiday spending)
    2: 0.9, // February
    3: 1.0, // March
    4: 1.0, // April
    5: 1.0, // May
    6: 1.0, // June
    7: 1.0, // July
    8: 1.0, // August
    9: 1.0, // September
    10: 1.0, // October
    11: 1.1, // November (holiday shopping)
    12: 1.2, // December (holiday season)
  };

  return seasonalFactors[monthNumber] || 1.0;
};

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
      console.log('No budget forecasts available after update attempt');
      return null;
    }

    // Extract all category predictions from forecasts
    const categoryData = {};
    const categories = [];

    // Check if we have category predictions in any of the forecasts
    let hasCategoryPredictions = false;

    forecast.budgetForecasts.forEach((monthForecast) => {
      if (monthForecast.categoryPredictions && Object.keys(monthForecast.categoryPredictions).length > 0) {
        hasCategoryPredictions = true;
      }
    });

    // If we have no category predictions, generate default ones for new accounts
    if (!hasCategoryPredictions) {
      console.log('No category predictions found, generating defaults for new account');
      return generateDefaultCategoryForecasts(specificCategory);
    }

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
      thirtyDayBudget: forecast.thirtyDayBudget || null,
    };
  } catch (error) {
    console.error('Error getting category forecasts:', error);
    throw error;
  }
};

// Helper function to generate default category forecasts for new accounts
function generateDefaultCategoryForecasts(specificCategory = null) {
  const defaultExpenseCategories = ['Продукти', 'Транспорт', 'Розваги', 'Комунальні платежі'];
  const defaultIncomeCategories = ['Зарплата', 'Стипендія', 'Підробіток', 'Інше'];

  const categoryData = {};

  // Generate data for the next 12 months
  const startDate = new Date();
  const months = [];

  for (let i = 0; i < 12; i++) {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + i);
    months.push({
      date: date,
      monthStr: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    });
  }

  // Add default expense categories with random variations
  defaultExpenseCategories.forEach((category) => {
    if (specificCategory && category !== specificCategory) return;

    categoryData[category] = {
      category,
      type: 'expense',
      monthlyPredictions: [],
    };

    // Base amount for each category
    const baseAmount =
      category === 'Продукти'
        ? 1000
        : category === 'Транспорт'
        ? 500
        : category === 'Розваги'
        ? 300
        : category === 'Комунальні платежі'
        ? 800
        : 500;

    // Generate monthly amounts with slight variations
    months.forEach((month) => {
      // Random variation between -10% and +20%
      const variation = 0.9 + Math.random() * 0.3;
      categoryData[category].monthlyPredictions.push({
        month: month.monthStr,
        date: month.date,
        amount: Math.round(baseAmount * variation),
      });
    });
  });

  // Add default income categories
  defaultIncomeCategories.forEach((category) => {
    if (specificCategory && category !== specificCategory) return;

    categoryData[category] = {
      category,
      type: 'income',
      monthlyPredictions: [],
    };

    // Base amount for each category
    const baseAmount =
      category === 'Зарплата'
        ? 2500
        : category === 'Стипендія'
        ? 1200
        : category === 'Підробіток'
        ? 800
        : category === 'Інше'
        ? 500
        : 1000;

    // Generate monthly amounts with slight variations
    months.forEach((month) => {
      // Random variation between -5% and +15%
      const variation = 0.95 + Math.random() * 0.2;
      categoryData[category].monthlyPredictions.push({
        month: month.monthStr,
        date: month.date,
        amount: Math.round(baseAmount * variation),
      });
    });
  });

  return {
    categories: Object.values(categoryData),
    lastUpdated: new Date(),
    thirtyDayBudget: 3000,
  };
}

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
      const thirtyDayBudget = await generateThirtyDayBudget(userId);

      // Update the forecast with new quick estimates
      forecast = await ForecastCollection.findOneAndUpdate(
        { userId },
        { quickEstimates, thirtyDayBudget, lastUpdated: new Date() },
        { upsert: true, new: true },
      );
    }

    return {
      quickEstimates: forecast.quickEstimates || [],
      thirtyDayBudget: forecast.thirtyDayBudget || null,
      lastUpdated: forecast.lastUpdated,
      calculationStatus: forecast.calculationStatus,
      calculationProgress: forecast.calculationProgress,
    };
  } catch (error) {
    console.error('Error getting quick estimates:', error);
    throw error;
  }
};
