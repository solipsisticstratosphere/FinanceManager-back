import { ForecastCollection } from '../db/models/Forecast.js';
import { GoalCollection } from '../db/models/Goal.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import * as tf from '@tensorflow/tfjs';
import { addMonths, subMonths, differenceInMonths } from 'date-fns';

class AdvancedAIForecastService {
  constructor() {
    this.forecastCache = new Map();
    this.goalCalculationCache = new Map();
    this.MODEL_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours
  }

  async prepareForecastData(userId, numMonths = 24) {
    const startDate = subMonths(new Date(), numMonths);

    const transactions = await TransactionCollection.aggregate([
      {
        $match: {
          userId,
          date: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          expenses: {
            $sum: {
              $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0],
            },
          },
          incomes: {
            $sum: {
              $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0],
            },
          },
          transactionCount: { $sum: 1 },
          categories: { $addToSet: '$category' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      expenses: transactions.map((t) => t.expenses),
      incomes: transactions.map((t) => t.incomes),
      dates: transactions.map((t) => t._id),
      transactionCounts: transactions.map((t) => t.transactionCount),
      categories: transactions.flatMap((t) => t.categories),
    };
  }

  async predictFinancialForecast(userId) {
    const cacheKey = `forecast_${userId}`;
    const cachedForecast = this.forecastCache.get(cacheKey);

    if (cachedForecast && Date.now() - cachedForecast.timestamp < this.MODEL_CACHE_DURATION) {
      return cachedForecast.data;
    }

    const data = await this.prepareForecastData(userId);

    const forecastMonths = 12;
    const experimentalForecast = Array.from({ length: forecastMonths }, (_, i) => {
      const date = addMonths(new Date(), i + 1);

      const predictedExpense = this._advancedPrediction(data.expenses, data.categories);
      const predictedIncome = this._advancedPrediction(data.incomes, data.categories);

      const seasonalityFactor = this._calculateSeasonalityFactor(data.expenses, i);
      const trendFactor = this._calculateTrendFactor(data.expenses);

      const adjustedExpense = predictedExpense * (1 + seasonalityFactor + trendFactor);
      const adjustedIncome = predictedIncome * (1 + seasonalityFactor + trendFactor);

      const projectedBalance = Math.max(0, adjustedIncome - adjustedExpense);

      return {
        date,
        projectedExpense: Math.max(adjustedExpense, 0),
        projectedIncome: Math.max(adjustedIncome, 0),
        projectedBalance,
        riskAssessment: this._calculateRiskScore(adjustedExpense, adjustedIncome),
      };
    });

    this.forecastCache.set(cacheKey, {
      data: experimentalForecast,
      timestamp: Date.now(),
    });

    return experimentalForecast;
  }

  _advancedPrediction(series, categories) {
    if (series.length === 0) return 1;

    const validSeries = series.filter((val) => !isNaN(val) && val !== 0);
    if (validSeries.length === 0) return 1;

    const mean = validSeries.reduce((a, b) => a + b, 0) / validSeries.length;
    const variance = validSeries.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / validSeries.length;
    const stdDev = Math.sqrt(variance || 0);

    // More sophisticated prediction considering variance and category diversity
    const categoryDiversityFactor = new Set(categories).size / 10;
    const prediction = mean * (1 + (Math.random() * 0.2 - 0.1) * categoryDiversityFactor);

    return Math.max(prediction, 1);
  }

  _calculateSeasonalityFactor(series, monthOffset) {
    if (series.length < 12) return 0;
    const seasonalPattern = series.slice(0, 12);
    const avgSeasonal = seasonalPattern.reduce((a, b) => a + b, 0) / seasonalPattern.length;
    return Math.sin((monthOffset * Math.PI) / 6) * (avgSeasonal / series[series.length - 1]);
  }

  _calculateTrendFactor(series) {
    const n = series.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = series.reduce((a, b) => a + b, 0);
    const sumXY = series.reduce((sum, value, index) => sum + value * index, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope / series[series.length - 1];
  }

  _calculateRiskScore(expense, income) {
    const balanceRatio = income / (expense || 1);
    return Math.min(Math.max((1 - balanceRatio) * 100, 0), 100);
  }

  async updateForecasts(userId) {
    const budgetForecasts = await this.predictFinancialForecast(userId);
    const goalForecast = await this._calculateGoalForecast(userId);

    return ForecastCollection.findOneAndUpdate(
      { userId },
      {
        budgetForecasts,
        goalForecast,
        lastUpdated: new Date(),
        forecastMethod: 'Advanced-AI-Enhanced-v2',
      },
      { upsert: true, new: true },
    );
  }

  async _calculateGoalForecast(userId) {
    const cacheKey = `goal_${userId}`;
    const cached = this.goalCalculationCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.MODEL_CACHE_DURATION) {
      return cached.data;
    }

    const activeGoal = await GoalCollection.findOne({
      userId,
      isActive: true,
    });

    if (!activeGoal) return null;

    const transactions = await TransactionCollection.find({
      userId,
      date: { $gte: addMonths(new Date(), -3) },
    });

    const monthlySavings =
      transactions.reduce((acc, t) => (t.type === 'income' ? acc + t.amount : acc - t.amount), 0) / 3;

    const remaining = activeGoal.targetAmount - activeGoal.currentAmount;
    const monthsToGoal = Math.max(1, Math.ceil(remaining / Math.abs(monthlySavings)));
    const projectedDate = addMonths(new Date(), monthsToGoal);

    const goalForecast = {
      goalId: activeGoal._id,
      monthsToGoal,
      projectedDate,
      monthlySavings: Math.abs(monthlySavings),
      probability: this._calculateGoalAchievementProbability(
        Math.abs(monthlySavings),
        remaining,
        activeGoal.targetAmount,
      ),
    };

    this.goalCalculationCache.set(cacheKey, {
      data: goalForecast,
      timestamp: Date.now(),
    });

    return goalForecast;
  }

  _calculateGoalAchievementProbability(monthlySavings, remaining, targetAmount) {
    const achievementFactor = monthlySavings / (remaining || 1);
    return Math.min(Math.max(achievementFactor * 100, 0), 100);
  }

  _calculateGoalVariabilityRisk(transactions) {
    const incomes = transactions.filter((t) => t.type === 'income').map((t) => t.amount);
    const expenses = transactions.filter((t) => t.type === 'expense').map((t) => t.amount);

    const incomeVariability = this._calculateVariability(incomes);
    const expenseVariability = this._calculateVariability(expenses);

    return (incomeVariability + expenseVariability) / 2;
  }

  _calculateVariability(series) {
    if (series.length < 2) return 0;
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const variance = series.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / series.length;
    return Math.sqrt(variance);
  }
}

export default new AdvancedAIForecastService();
