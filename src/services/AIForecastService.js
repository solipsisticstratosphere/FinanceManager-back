import { ForecastCollection } from '../db/models/Forecast.js';
import { GoalCollection } from '../db/models/Goal.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import * as tf from '@tensorflow/tfjs';
import { addMonths, subMonths, differenceInMonths, format, parse, isLastDayOfMonth, getDaysInMonth } from 'date-fns';
import mongoose from 'mongoose';

class AdvancedAIForecastService {
  constructor() {
    this.forecastCache = new Map();
    this.goalCalculationCache = new Map();
    this.MODEL_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours
    this.tfModels = new Map();
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
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' },
          },
          yearMonth: { $first: { $dateToString: { format: '%Y-%m', date: '$date' } } },
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
          categoryExpenses: {
            $push: {
              $cond: [{ $eq: ['$type', 'expense'] }, { category: '$category', amount: '$amount' }, null],
            },
          },
          categoryIncomes: {
            $push: {
              $cond: [{ $eq: ['$type', 'income'] }, { category: '$category', amount: '$amount' }, null],
            },
          },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const processedTransactions = transactions.map((t) => {
      const expensesByCategory = {};
      t.categoryExpenses
        .filter((item) => item !== null)
        .forEach((item) => {
          if (!expensesByCategory[item.category]) {
            expensesByCategory[item.category] = 0;
          }
          expensesByCategory[item.category] += item.amount;
        });

      const incomesByCategory = {};
      t.categoryIncomes
        .filter((item) => item !== null)
        .forEach((item) => {
          if (!incomesByCategory[item.category]) {
            incomesByCategory[item.category] = 0;
          }
          incomesByCategory[item.category] += item.amount;
        });

      return {
        ...t,
        expensesByCategory,
        incomesByCategory,
      };
    });

    const trendsData = processedTransactions.map((t, i) => {
      if (i === 0) {
        return {
          expenseGrowth: 0,
          incomeGrowth: 0,
          netChange: 0,
        };
      }

      const prevMonth = processedTransactions[i - 1];
      const expenseGrowth = prevMonth.expenses === 0 ? 0 : (t.expenses - prevMonth.expenses) / prevMonth.expenses;
      const incomeGrowth = prevMonth.incomes === 0 ? 0 : (t.incomes - prevMonth.incomes) / prevMonth.incomes;
      const netChange = t.incomes - t.expenses - (prevMonth.incomes - prevMonth.expenses);

      return {
        expenseGrowth,
        incomeGrowth,
        netChange,
      };
    });

    const allCategories = new Set();
    processedTransactions.forEach((t) => {
      Object.keys(t.expensesByCategory).forEach((cat) => allCategories.add(cat));
      Object.keys(t.incomesByCategory).forEach((cat) => allCategories.add(cat));
    });

    return {
      expenses: processedTransactions.map((t) => t.expenses),
      incomes: processedTransactions.map((t) => t.incomes),
      dates: processedTransactions.map((t) => t.yearMonth),
      transactionCounts: processedTransactions.map((t) => t.transactionCount),
      categories: Array.from(allCategories),
      processedTransactions,
      trendsData,
      rawData: transactions,
    };
  }

  async predictFinancialForecast(userId) {
    const cacheKey = `forecast_${userId}`;
    const cachedForecast = this.forecastCache.get(cacheKey);

    if (cachedForecast && Date.now() - cachedForecast.timestamp < this.MODEL_CACHE_DURATION) {
      return cachedForecast.data;
    }

    // Get historical data for pattern analysis (24 months)
    const historicalData = await this.prepareForecastData(userId, 24);

    // Get recent data for current expense/income levels (last 30 days)
    const last30DaysData = await this.prepareRecentTransactionData(userId, 30);

    // If no recent transactions, try to get user's balance data for baseline
    if (last30DaysData.transactionCount === 0) {
      const userData = await this._getUserData(userId);
      if (userData) {
        // Use user balance to create a baseline
        last30DaysData.totalExpense = userData.averageMonthlyExpense || userData.balance * 0.7; // Assume 70% of balance as monthly expense if no history
        last30DaysData.totalIncome = userData.averageMonthlyIncome || userData.balance * 1.2; // Assume 120% of balance as monthly income if no history
      }
    }

    // Ensure minimum values for predictions
    last30DaysData.totalExpense = Math.max(last30DaysData.totalExpense || 0, 1000); // Minimum baseline expense
    last30DaysData.totalIncome = Math.max(last30DaysData.totalIncome || 0, 1200); // Minimum baseline income

    // Early return with default safe values if we don't have sufficient data
    if (!historicalData.expenses || historicalData.expenses.length === 0) {
      return this._createDefaultForecastWithBaseline(12, last30DaysData.totalExpense, last30DaysData.totalIncome);
    }

    let useNeuralModel = historicalData.expenses.length >= 12;
    let modelPredictions = null;

    if (useNeuralModel) {
      try {
        modelPredictions = await this._getModelPredictions(historicalData, userId);
      } catch (err) {
        console.error('Neural model prediction failed, falling back to statistical methods:', err);
        useNeuralModel = false;
      }
    }

    const forecastMonths = 12;
    const experimentalForecast = Array.from({ length: forecastMonths }, (_, i) => {
      // Ensure date is a valid Date object at midnight (to avoid timezone issues)
      const forecastDate = new Date();
      forecastDate.setDate(1); // First day of month
      forecastDate.setHours(0, 0, 0, 0); // Midnight
      forecastDate.setMonth(forecastDate.getMonth() + i + 1); // Future month

      const monthIndex = i % 12;
      const monthName = format(forecastDate, 'MMMM');

      let predictedExpense, predictedIncome;

      if (useNeuralModel && modelPredictions) {
        predictedExpense = modelPredictions.expenses[i] || last30DaysData.totalExpense;
        predictedIncome = modelPredictions.incomes[i] || last30DaysData.totalIncome;
      } else {
        // Use last 30 days as base for expense/income, but use patterns from historical data
        predictedExpense = this._calculateRecentBasedPrediction(
          last30DaysData.totalExpense,
          historicalData.expenses,
          historicalData.categories,
          monthIndex,
          historicalData.trendsData,
        );

        predictedIncome = this._calculateRecentBasedPrediction(
          last30DaysData.totalIncome,
          historicalData.incomes,
          historicalData.categories,
          monthIndex,
          historicalData.trendsData,
        );
      }

      // Ensure we have valid numbers
      predictedExpense =
        isNaN(predictedExpense) || predictedExpense <= 0 ? last30DaysData.totalExpense : predictedExpense;
      predictedIncome = isNaN(predictedIncome) || predictedIncome <= 0 ? last30DaysData.totalIncome : predictedIncome;

      const seasonalityFactor = this._calculateSeasonalityFactor(historicalData.expenses, monthIndex);
      let trendFactor = this._calculateTrendFactor(historicalData.expenses);

      // Handle potential Infinity values
      trendFactor = !isFinite(trendFactor) ? 0 : trendFactor;

      const categoryAdjustment = this._calculateCategoryBasedAdjustment(
        historicalData.processedTransactions,
        monthIndex,
      );
      const economicAdjustment = this._simulateEconomicIndicatorsAdjustment(i);

      // Ensure all factors are valid numbers
      const safeSeasonalityFactor = isNaN(seasonalityFactor) ? 0 : seasonalityFactor;
      const safeTrendFactor = isNaN(trendFactor) ? 0 : trendFactor;
      const safeCategoryAdjustment = isNaN(categoryAdjustment) ? 0 : categoryAdjustment;
      const safeEconomicAdjustment = isNaN(economicAdjustment) ? 0 : economicAdjustment;

      const adjustmentFactors =
        1 + safeSeasonalityFactor + safeTrendFactor + safeCategoryAdjustment + safeEconomicAdjustment;

      // Ensure adjustment factor is valid
      const safeAdjustmentFactor = !isFinite(adjustmentFactors) || isNaN(adjustmentFactors) ? 1 : adjustmentFactors;

      const adjustedExpense = predictedExpense * safeAdjustmentFactor;
      const adjustedIncome = predictedIncome * safeAdjustmentFactor;

      // Ensure the values are valid numbers
      const safeExpense = Math.max(
        last30DaysData.totalExpense * 0.5,
        isNaN(adjustedExpense) ? last30DaysData.totalExpense : adjustedExpense,
      );
      const safeIncome = Math.max(
        last30DaysData.totalIncome * 0.5,
        isNaN(adjustedIncome) ? last30DaysData.totalIncome : adjustedIncome,
      );

      // Calculate the net balance (can be negative)
      const projectedBalance = safeIncome - safeExpense;

      const confIntervals = this._calculateConfidenceInterval(safeExpense, historicalData.expenses);
      const confIntervalsIncome = this._calculateConfidenceInterval(safeIncome, historicalData.incomes);

      // Ensure confidence intervals have valid values
      const safeConfidenceIntervals = {
        expense: {
          lower: isNaN(confIntervals.lower) ? 0 : Math.max(0, confIntervals.lower),
          upper: isNaN(confIntervals.upper) ? safeExpense * 1.2 : confIntervals.upper,
        },
        income: {
          lower: isNaN(confIntervalsIncome.lower) ? 0 : Math.max(0, confIntervalsIncome.lower),
          upper: isNaN(confIntervalsIncome.upper) ? safeIncome * 1.2 : confIntervalsIncome.upper,
        },
      };

      const riskAssessment = this._calculateEnhancedRiskScore(safeExpense, safeIncome, historicalData.trendsData);
      const safeRiskAssessment = isNaN(riskAssessment) ? 50 : riskAssessment;

      return {
        date: forecastDate,
        projectedExpense: safeExpense,
        projectedIncome: safeIncome,
        projectedBalance,
        confidenceIntervals: safeConfidenceIntervals,
        riskAssessment: safeRiskAssessment,
        month: monthName,
        adjustmentFactors: {
          seasonality: safeSeasonalityFactor,
          trend: safeTrendFactor,
          category: safeCategoryAdjustment,
          economic: safeEconomicAdjustment,
        },
      };
    });

    this.forecastCache.set(cacheKey, {
      data: experimentalForecast,
      timestamp: Date.now(),
    });

    return experimentalForecast;
  }

  async _getModelPredictions(data, userId) {
    const modelCacheKey = `model_${userId}`;
    let model = this.tfModels.get(modelCacheKey);

    if (!model || Date.now() - model.timestamp > this.MODEL_CACHE_DURATION) {
      model = await this._createTensorflowModel(data);
      this.tfModels.set(modelCacheKey, {
        model: model,
        timestamp: Date.now(),
      });
    } else {
      model = model.model;
    }

    const expenseInputs = this._normalizeData(data.expenses);
    const incomeInputs = this._normalizeData(data.incomes);

    const expensePredictions = [];
    const incomePredictions = [];

    let lastExpenseWindow = expenseInputs.slice(-6);
    let lastIncomeWindow = incomeInputs.slice(-6);

    for (let i = 0; i < 12; i++) {
      const expenseTensor = tf.tensor2d([lastExpenseWindow]);
      const incomeTensor = tf.tensor2d([lastIncomeWindow]);

      const expensePrediction = model.predict(expenseTensor).dataSync()[0];
      const incomePrediction = model.predict(incomeTensor).dataSync()[0];

      const denormalizedExpense = expensePrediction * (Math.max(...data.expenses) || 1);
      const denormalizedIncome = incomePrediction * (Math.max(...data.incomes) || 1);

      expensePredictions.push(denormalizedExpense);
      incomePredictions.push(denormalizedIncome);

      lastExpenseWindow = [...lastExpenseWindow.slice(1), expensePrediction];
      lastIncomeWindow = [...lastIncomeWindow.slice(1), incomePrediction];

      expenseTensor.dispose();
      incomeTensor.dispose();
    }

    return {
      expenses: expensePredictions,
      incomes: incomePredictions,
    };
  }

  async _createTensorflowModel(data) {
    if (data.expenses.length < 12) {
      throw new Error('Not enough data for ML model');
    }

    const normalizedExpenses = this._normalizeData(data.expenses);
    const normalizedIncomes = this._normalizeData(data.incomes);

    const sequenceLength = 6;
    const trainingData = [];

    for (let i = 0; i < normalizedExpenses.length - sequenceLength; i++) {
      const xExpense = normalizedExpenses.slice(i, i + sequenceLength);
      const yExpense = normalizedExpenses[i + sequenceLength];
      trainingData.push({ input: xExpense, output: yExpense });
    }

    const model = tf.sequential();

    model.add(
      tf.layers.lstm({
        units: 16,
        inputShape: [sequenceLength, 1],
        returnSequences: false,
      }),
    );

    model.add(tf.layers.dense({ units: 1 }));

    model.compile({
      optimizer: tf.train.adam(0.01),
      loss: 'meanSquaredError',
    });

    const xs = tf.tensor3d(
      trainingData.map((d) => d.input.map((x) => [x])),
      [trainingData.length, sequenceLength, 1],
    );

    const ys = tf.tensor2d(
      trainingData.map((d) => [d.output]),
      [trainingData.length, 1],
    );

    await model.fit(xs, ys, {
      epochs: 100,
      batchSize: 32,
      shuffle: true,
      verbose: 0,
    });

    xs.dispose();
    ys.dispose();

    return model;
  }

  _normalizeData(data) {
    const max = Math.max(...data) || 1;
    return data.map((val) => val / max);
  }

  _calculateConfidenceInterval(prediction, historicalData) {
    if (!historicalData || historicalData.length < 2) {
      return {
        lower: Math.max(0, prediction * 0.8),
        upper: prediction * 1.2,
      };
    }

    const validData = historicalData.filter((value) => isFinite(value) && !isNaN(value));
    if (validData.length < 2) {
      return {
        lower: Math.max(0, prediction * 0.8),
        upper: prediction * 1.2,
      };
    }

    const mean = validData.reduce((a, b) => a + b, 0) / validData.length;
    const variance = validData.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / validData.length;
    const stdDev = Math.sqrt(variance || 1);

    const margin = 1.96 * stdDev;

    return {
      lower: Math.max(0, prediction - margin),
      upper: prediction + margin,
    };
  }

  _enhancedStatisticalPrediction(series, categories, monthIndex, trendsData) {
    if (series.length === 0) return 1;

    const validSeries = series.filter((val) => !isNaN(val) && val !== 0);
    if (validSeries.length === 0) return 1;

    const recentTrend = this._calculateRecentTrend(validSeries);

    const weightedMean = this._calculateWeightedAverage(validSeries);

    const monthlyAverage = this._calculateMonthlyAverage(validSeries, monthIndex);

    const categoryDiversityFactor = new Set(categories).size / 10;

    const growthFactor =
      trendsData.length > 0
        ? trendsData
            .slice(-3)
            .reduce((acc, t) => acc + (series === validSeries ? t.expenseGrowth : t.incomeGrowth), 0) / 3
        : 0;

    const prediction =
      weightedMean *
      (1 + recentTrend) *
      (monthlyAverage > 0 ? monthlyAverage / weightedMean : 1) *
      (1 + 0.1 * categoryDiversityFactor) *
      (1 + growthFactor);

    return Math.max(prediction, 1);
  }

  _calculateWeightedAverage(series) {
    const weights = series.map((_, i) => i + 1);
    const weightSum = weights.reduce((a, b) => a + b, 0);

    return series.reduce((sum, val, i) => sum + val * weights[i], 0) / weightSum;
  }

  _calculateRecentTrend(series) {
    const recentMonths = Math.min(6, series.length);
    const recentData = series.slice(-recentMonths);

    if (recentMonths < 2) return 0;

    let totalChange = 0;
    for (let i = 1; i < recentData.length; i++) {
      const prevValue = recentData[i - 1] || 1;
      totalChange += (recentData[i] - prevValue) / prevValue;
    }

    return totalChange / (recentMonths - 1);
  }

  _calculateMonthlyAverage(series, monthIndex) {
    if (series.length < 12) return 0;

    const monthValues = [];
    for (let i = monthIndex; i < series.length; i += 12) {
      monthValues.push(series[i]);
    }

    return monthValues.length > 0 ? monthValues.reduce((a, b) => a + b, 0) / monthValues.length : 0;
  }

  _calculateCategoryBasedAdjustment(processedTransactions, monthIndex) {
    if (!processedTransactions || processedTransactions.length < 12) return 0;

    const monthData = [];
    for (let i = monthIndex; i < processedTransactions.length; i += 12) {
      monthData.push(processedTransactions[i]);
    }

    if (monthData.length === 0) return 0;

    let categoryVariance = 0;

    monthData.forEach((month) => {
      const categoryRatios = Object.entries(month.expensesByCategory).map(([cat, amount]) => ({
        category: cat,
        ratio: amount / (month.expenses || 1),
      }));

      categoryVariance += categoryRatios.reduce((sum, cat) => sum + (cat.ratio - 0.5) * 0.1, 0);
    });

    return categoryVariance / monthData.length;
  }

  _simulateEconomicIndicatorsAdjustment(monthsAhead) {
    const economicCycle = Math.sin((Date.now() / (365 * 24 * 60 * 60 * 1000)) * Math.PI) * 0.05;

    const uncertaintyFactor = monthsAhead * 0.002;

    return economicCycle + (Math.random() * 2 - 1) * uncertaintyFactor;
  }

  _calculateEnhancedRiskScore(expense, income, trendsData) {
    // Handle zero cases and invalid inputs
    if (expense <= 0 || income <= 0) return 50; // Default medium risk

    const balanceRatio = income / expense;
    if (!isFinite(balanceRatio) || isNaN(balanceRatio)) return 50;

    let volatilityFactor = 0;
    if (trendsData && trendsData.length >= 3) {
      try {
        const recentTrends = trendsData.slice(-3);
        const expenseGrowthRates = recentTrends.map((t) => t.expenseGrowth).filter((v) => isFinite(v) && !isNaN(v));
        const incomeGrowthRates = recentTrends.map((t) => t.incomeGrowth).filter((v) => isFinite(v) && !isNaN(v));

        const expenseVolatility =
          expenseGrowthRates.length > 0
            ? Math.abs(expenseGrowthRates.reduce((sum, t) => sum + t, 0) / expenseGrowthRates.length)
            : 0;

        const incomeVolatility =
          incomeGrowthRates.length > 0
            ? Math.abs(incomeGrowthRates.reduce((sum, t) => sum + t, 0) / incomeGrowthRates.length)
            : 0;

        volatilityFactor = (expenseVolatility + incomeVolatility) / 2;
      } catch (error) {
        console.error('Error calculating volatility factor:', error);
        volatilityFactor = 0;
      }
    }

    if (!isFinite(volatilityFactor) || isNaN(volatilityFactor)) volatilityFactor = 0;

    const baseRisk = Math.min(Math.max((1 - balanceRatio) * 100, 0), 100);
    const volatilityRisk = volatilityFactor * 20;

    return Math.min(Math.max(baseRisk + volatilityRisk, 0), 100);
  }

  _calculateSeasonalityFactor(series, monthOffset) {
    if (series.length < 12) return 0;
    const seasonalPattern = series.slice(0, 12);
    const avgSeasonal = seasonalPattern.reduce((a, b) => a + b, 0) / seasonalPattern.length;
    return Math.sin((monthOffset * Math.PI) / 6) * (avgSeasonal / series[series.length - 1]);
  }

  _calculateTrendFactor(series) {
    const n = series.length;
    if (n < 2) return 0;

    const sumX = (n * (n - 1)) / 2;
    const sumY = series.reduce((a, b) => a + b, 0);
    const sumXY = series.reduce((sum, value, index) => sum + value * index, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return 0;

    const slope = (n * sumXY - sumX * sumY) / denominator;

    // Avoid division by zero and handle extreme values
    const lastValue = series[series.length - 1];
    if (lastValue === 0 || !isFinite(lastValue)) return 0;

    const factor = slope / lastValue;

    // Limit the trend factor to reasonable bounds to avoid NaN/Infinity
    return Math.max(Math.min(factor, 2), -2);
  }

  async updateForecasts(userId, session = null, detailed = false) {
    const budgetForecasts = await this.predictFinancialForecast(userId);
    const goalForecast = await this._calculateGoalForecast(userId);

    const forecastData = {
      userId,
      budgetForecasts,
      goalForecast,
      lastUpdated: new Date(),
      forecastMethod: 'Advanced-AI-Enhanced-v3',
    };

    if (detailed) {
      // Get historical data for patterns and trends
      const historicalData = await this.prepareForecastData(userId, 24);

      // Get recent data (last 30 days)
      const recentData = await this.prepareRecentTransactionData(userId, 30);

      forecastData.details = {
        historicalExpenses: historicalData.expenses,
        historicalIncomes: historicalData.incomes,
        historicalDates: historicalData.dates,
        categoryDistribution: this._calculateCategoryDistribution(historicalData.processedTransactions),
        volatilityMetrics: this._calculateVolatilityMetrics(historicalData.trendsData),
        seasonalPatterns: this._identifySeasonalPatterns(historicalData.expenses, historicalData.incomes),
        last30Days: {
          dailyExpense: recentData.dailyExpense || 0,
          dailyIncome: recentData.dailyIncome || 0,
          monthlyProjectedExpense: recentData.totalExpense || 0,
          monthlyProjectedIncome: recentData.totalIncome || 0,
          transactionCount: recentData.transactionCount || 0,
          expenseCategories: recentData.expenseCategories || [],
          incomeCategories: recentData.incomeCategories || [],
          netBalance: (recentData.totalIncome || 0) - (recentData.totalExpense || 0),
        },
      };
    }

    if (session) {
      return ForecastCollection.findOneAndUpdate({ userId }, forecastData, { upsert: true, new: true, session });
    } else {
      return ForecastCollection.findOneAndUpdate({ userId }, forecastData, { upsert: true, new: true });
    }
  }

  _calculateCategoryDistribution(processedTransactions) {
    if (!processedTransactions || processedTransactions.length === 0) return [];

    const categoryTotals = {};

    processedTransactions.forEach((month) => {
      Object.entries(month.expensesByCategory || {}).forEach(([category, amount]) => {
        if (!categoryTotals[category]) {
          categoryTotals[category] = 0;
        }
        categoryTotals[category] += amount;
      });
    });

    const totalExpenses = Object.values(categoryTotals).reduce((sum, amount) => sum + amount, 0);

    return Object.entries(categoryTotals)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  _calculateVolatilityMetrics(trendsData) {
    if (!trendsData || trendsData.length < 3) return null;

    const expenseGrowthRates = trendsData.map((t) => t.expenseGrowth);
    const incomeGrowthRates = trendsData.map((t) => t.incomeGrowth);

    return {
      expenseVolatility: this._calculateVariability(expenseGrowthRates),
      incomeVolatility: this._calculateVariability(incomeGrowthRates),
      netChangeVolatility: this._calculateVariability(trendsData.map((t) => t.netChange)),
      trend: this._identifyTrend(trendsData.map((t) => t.netChange)),
    };
  }

  _identifyTrend(series) {
    if (series.length < 3) return 'insufficient_data';

    const thirdSize = Math.floor(series.length / 3);
    const firstThird = series.slice(0, thirdSize);
    const lastThird = series.slice(-thirdSize);

    const firstAvg = firstThird.reduce((sum, val) => sum + val, 0) / firstThird.length;
    const lastAvg = lastThird.reduce((sum, val) => sum + val, 0) / lastThird.length;

    const trendStrength = Math.abs(lastAvg - firstAvg) / Math.max(Math.abs(firstAvg), 1);

    if (trendStrength < 0.1) return 'stable';
    if (lastAvg > firstAvg) return trendStrength > 0.3 ? 'strong_positive' : 'positive';
    return trendStrength > 0.3 ? 'strong_negative' : 'negative';
  }

  _identifySeasonalPatterns(expenses, incomes) {
    if (expenses.length < 12 || incomes.length < 12) return null;

    const quarters = [
      { name: 'Q1', months: [0, 1, 2] },
      { name: 'Q2', months: [3, 4, 5] },
      { name: 'Q3', months: [6, 7, 8] },
      { name: 'Q4', months: [9, 10, 11] },
    ];

    const quarterlyExpenses = quarters.map((q) => {
      const quarterMonths = [];
      for (let i = 0; i < expenses.length; i++) {
        const monthIndex = i % 12;
        if (q.months.includes(monthIndex)) {
          quarterMonths.push(expenses[i]);
        }
      }
      return {
        quarter: q.name,
        average: quarterMonths.length > 0 ? quarterMonths.reduce((sum, val) => sum + val, 0) / quarterMonths.length : 0,
      };
    });

    const quarterlyIncomes = quarters.map((q) => {
      const quarterMonths = [];
      for (let i = 0; i < incomes.length; i++) {
        const monthIndex = i % 12;
        if (q.months.includes(monthIndex)) {
          quarterMonths.push(incomes[i]);
        }
      }
      return {
        quarter: q.name,
        average: quarterMonths.length > 0 ? quarterMonths.reduce((sum, val) => sum + val, 0) / quarterMonths.length : 0,
      };
    });

    return {
      quarterlyExpenses,
      quarterlyIncomes,
      highExpenseQuarter: [...quarterlyExpenses].sort((a, b) => b.average - a.average)[0],
      highIncomeQuarter: [...quarterlyIncomes].sort((a, b) => b.average - a.average)[0],
    };
  }

  async _calculateGoalForecast(userId) {
    const cacheKey = `goal_${userId}`;
    const cached = this.goalCalculationCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.MODEL_CACHE_DURATION) {
      return cached.data;
    }

    try {
      const activeGoal = await GoalCollection.findOne({
        userId,
        isActive: true,
      });

      if (!activeGoal) return null;

      // Get transaction data from the last 30 days for current rate calculation
      const recentData = await this.prepareRecentTransactionData(userId, 30);

      // If no recent transactions, fall back to historical approach with 3 months data
      if (recentData.transactionCount === 0) {
        const pastMonths = 3;
        const transactions = await TransactionCollection.find({
          userId,
          date: { $gte: addMonths(new Date(), -pastMonths) },
        }).sort({ date: 1 });

        if (!transactions.length) {
          return this._createDefaultGoalForecast(activeGoal);
        }

        const monthlyTransactions = this._groupTransactionsByMonth(transactions);

        // Calculate average monthly savings with weighted average
        const monthlySavings = this._calculateWeightedMonthlySavings(monthlyTransactions);

        // Ensure we have a valid monthlySavings value
        const safeMonthlySavings = isNaN(monthlySavings) || !isFinite(monthlySavings) ? 0 : monthlySavings;

        // Calculate savings volatility
        const savingsVolatility = this._calculateSavingsVolatility(monthlyTransactions);

        // Ensure volatility is a valid number
        const safeVolatility =
          isNaN(savingsVolatility) || !isFinite(savingsVolatility) ? 0.5 : Math.min(Math.max(savingsVolatility, 0), 1);

        return this._generateGoalForecast(activeGoal, safeMonthlySavings, safeVolatility, transactions);
      }

      // Calculate monthly savings from daily data
      const monthlySavings = recentData.totalIncome - recentData.totalExpense;

      // Fallback to get historical data for volatility calculation
      const pastMonths = 3;
      const transactions = await TransactionCollection.find({
        userId,
        date: { $gte: addMonths(new Date(), -pastMonths) },
      }).sort({ date: 1 });

      // Calculate volatility from historical data
      let savingsVolatility = 0.5; // Default value

      if (transactions.length > 0) {
        const monthlyTransactions = this._groupTransactionsByMonth(transactions);
        const calculatedVolatility = this._calculateSavingsVolatility(monthlyTransactions);
        savingsVolatility =
          isNaN(calculatedVolatility) || !isFinite(calculatedVolatility)
            ? 0.5
            : Math.min(Math.max(calculatedVolatility, 0), 1);
      }

      return this._generateGoalForecast(activeGoal, monthlySavings, savingsVolatility, transactions);
    } catch (error) {
      console.error('Error calculating goal forecast:', error);
      return null;
    }
  }

  // Extract goal forecast calculation logic to a separate method
  _generateGoalForecast(activeGoal, monthlySavings, savingsVolatility, transactions) {
    // Calculate remaining amount needed
    const remaining = activeGoal.targetAmount - activeGoal.currentAmount;

    // Calculate projected completion based on current rate
    let monthsToGoal;
    let projectedDate = null;

    if (monthlySavings <= 0) {
      // If not saving or spending more than earning, goal won't be reached
      monthsToGoal = null;
    } else {
      // Calculate months needed with adjustment for volatility
      const volatilityAdjustedSavings = monthlySavings * (1 - savingsVolatility * 0.5);
      monthsToGoal = Math.max(1, Math.ceil(remaining / Math.abs(volatilityAdjustedSavings)));

      // Cap months to goal at a reasonable maximum
      monthsToGoal = Math.min(monthsToGoal, 240); // 20 years max

      // Create a valid date object for the projected date
      const today = new Date();
      today.setDate(1); // First day of the month
      today.setHours(0, 0, 0, 0); // Midnight
      projectedDate = new Date(today); // Clone today
      projectedDate.setMonth(today.getMonth() + monthsToGoal); // Add months
    }

    // Get months until deadline if it exists
    let monthsUntilDeadline = null;
    if (activeGoal.deadline) {
      const deadlineDate = new Date(activeGoal.deadline);
      if (isNaN(deadlineDate.getTime())) {
        // Invalid deadline date
        monthsUntilDeadline = null;
      } else {
        // Ensure deadlineDate is set to midnight for consistent calculations
        deadlineDate.setHours(0, 0, 0, 0);
        monthsUntilDeadline = differenceInMonths(deadlineDate, new Date());
      }
    }

    // Calculate achievability score considering multiple factors
    const achievabilityScore = this._calculateEnhancedGoalAchievabilityScore(
      monthlySavings,
      remaining,
      activeGoal.targetAmount,
      savingsVolatility,
      monthsUntilDeadline,
    );

    // Ensure score is a valid number
    const safeScore =
      isNaN(achievabilityScore) || !isFinite(achievabilityScore) ? 0 : Math.min(Math.max(achievabilityScore, 0), 100);

    // Calculate milestones for the goal
    const milestones = this._calculateGoalMilestones(
      activeGoal.currentAmount,
      activeGoal.targetAmount,
      monthlySavings,
      savingsVolatility,
    );

    // Generate adjustment suggestions
    const suggestions = this._generateAdjustmentSuggestions(
      monthlySavings,
      remaining,
      activeGoal.deadline ? new Date(activeGoal.deadline) : null,
      transactions,
    );

    const goalForecast = {
      goalId: activeGoal._id,
      goalName: activeGoal.name || 'Financial Goal',
      currentAmount: activeGoal.currentAmount || 0,
      targetAmount: activeGoal.targetAmount || 0,
      monthsToGoal: monthsToGoal,
      projectedDate,
      monthlySavings: Math.abs(monthlySavings),
      savingsVolatility: savingsVolatility,
      probability: safeScore,
      isAchievable: safeScore > 25,
      milestones,
      adjustmentSuggestions: suggestions,
    };

    this.goalCalculationCache.set(`goal_${activeGoal.userId}`, {
      data: goalForecast,
      timestamp: Date.now(),
    });

    return goalForecast;
  }

  _calculateGoalMilestones(currentAmount, targetAmount, monthlySavings, volatility) {
    // Validate inputs
    if (!isFinite(monthlySavings) || monthlySavings <= 0 || !isFinite(currentAmount) || !isFinite(targetAmount)) {
      return [];
    }

    try {
      const milestones = [];
      const remaining = targetAmount - currentAmount;

      if (remaining <= 0) return []; // Goal already achieved

      // Define milestone percentages
      const milestonePercentages = [25, 50, 75, 90, 100];

      // Create a base date object
      const today = new Date();
      today.setDate(1); // First day of the month
      today.setHours(0, 0, 0, 0); // Midnight

      milestonePercentages.forEach((percentage) => {
        const milestoneAmount = targetAmount * (percentage / 100);

        // Skip milestones already achieved
        if (milestoneAmount <= currentAmount) return;

        const amountNeeded = milestoneAmount - currentAmount;

        // Adjust estimated months based on volatility
        const safeVolatility = isFinite(volatility) && !isNaN(volatility) ? Math.min(Math.max(volatility, 0), 1) : 0.5;

        const volatilityAdjustedSavings = monthlySavings * (1 - safeVolatility * 0.3);
        let estimatedMonths = Math.ceil(amountNeeded / volatilityAdjustedSavings);

        // Cap estimated months to a reasonable value
        estimatedMonths = Math.min(estimatedMonths, 240); // Max 20 years

        // Create a valid date for the projection
        const projectedDate = new Date(today);
        projectedDate.setMonth(today.getMonth() + estimatedMonths);

        milestones.push({
          percentage,
          amount: milestoneAmount,
          estimatedMonths,
          projectedDate,
          amountNeeded,
        });
      });

      return milestones;
    } catch (error) {
      console.error('Error calculating goal milestones:', error);
      return [];
    }
  }

  _calculateWeightedMonthlySavings(monthlyTransactions) {
    const monthKeys = Object.keys(monthlyTransactions).sort();

    if (monthKeys.length === 0) return 0;

    try {
      // Apply exponentially increasing weights to more recent months
      const weights = monthKeys.map((_, i) => Math.pow(1.5, i));
      const weightSum = weights.reduce((a, b) => a + b, 0) || 1; // Avoid division by zero

      let weightedSavings = 0;
      monthKeys.forEach((month, i) => {
        const net = monthlyTransactions[month].net;
        if (isFinite(net) && !isNaN(net)) {
          weightedSavings += net * weights[i];
        }
      });

      return weightedSavings / weightSum;
    } catch (error) {
      console.error('Error calculating weighted monthly savings:', error);
      return 0;
    }
  }

  _calculateSavingsVolatility(monthlyTransactions) {
    const monthKeys = Object.keys(monthlyTransactions).sort();

    if (monthKeys.length < 2) return 1; // Maximum volatility if not enough data

    try {
      const netSavings = monthKeys
        .map((month) => monthlyTransactions[month].net)
        .filter((value) => isFinite(value) && !isNaN(value));

      if (netSavings.length < 2) return 1;

      const avgSavings = netSavings.reduce((a, b) => a + b, 0) / netSavings.length;

      // Calculate coefficient of variation (standard deviation / mean)
      const squaredDiffs = netSavings.map((net) => Math.pow(net - avgSavings, 2));
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / netSavings.length;
      const stdDev = Math.sqrt(variance || 1);

      // Normalize volatility between 0 and 1
      // 0 = perfectly consistent, 1 = highly volatile
      const volatility = Math.abs(avgSavings) < 0.1 ? 1 : stdDev / Math.abs(avgSavings);

      return Math.min(Math.max(volatility, 0), 1);
    } catch (error) {
      console.error('Error calculating savings volatility:', error);
      return 1; // Max volatility in case of error
    }
  }

  _calculateEnhancedGoalAchievabilityScore(monthlySavings, remaining, targetAmount, volatility, monthsUntilDeadline) {
    // Ensure all inputs are valid numbers
    if (!isFinite(monthlySavings) || !isFinite(remaining) || !isFinite(targetAmount)) {
      return 0;
    }

    if (remaining <= 0) return 100; // Already achieved
    if (monthlySavings <= 0) return 0; // Can't achieve with negative savings

    // Base achievability based on savings rate
    const baseProbability = (monthlySavings / remaining) * 100;

    // Adjustments based on multiple factors
    const adjustments = [];

    // Factor 1: Volatility penalty (0-30%)
    const safeVolatility = isFinite(volatility) && !isNaN(volatility) ? Math.min(Math.max(volatility, 0), 1) : 0.5;
    const volatilityPenalty = safeVolatility * 30;
    adjustments.push(-volatilityPenalty);

    // Factor 2: Target size relative to monthly savings (0-20%)
    const targetSizeFactor = Math.min((monthlySavings * 12) / targetAmount, 1) * 20;
    adjustments.push(targetSizeFactor);

    // Factor 3: Progress bonus (0-15%)
    const progressBonus = ((targetAmount - remaining) / targetAmount) * 15;
    adjustments.push(progressBonus);

    // Factor 4: Deadline pressure if applicable (-40% to 0%)
    let deadlinePenalty = 0;
    if (monthsUntilDeadline !== null && isFinite(monthsUntilDeadline)) {
      // Calculate expected months to goal based on current savings rate
      const expectedMonths = remaining / monthlySavings;

      if (Number.isFinite(expectedMonths)) {
        // Penalize if expected completion is after deadline
        deadlinePenalty = monthsUntilDeadline >= expectedMonths ? 0 : -40 * (1 - monthsUntilDeadline / expectedMonths);
      } else {
        deadlinePenalty = -40; // Maximum penalty if can't calculate
      }
    }
    adjustments.push(deadlinePenalty);

    // Apply all adjustments
    const adjustedProbability = baseProbability + adjustments.reduce((a, b) => a + b, 0);

    // Cap at 0-100%
    return Math.min(Math.max(adjustedProbability, 0), 100);
  }

  _generateAdjustmentSuggestions(monthlySavings, remaining, deadline, transactions) {
    const suggestions = [];

    try {
      // Validate inputs
      if (!isFinite(monthlySavings) || !isFinite(remaining)) {
        return [
          {
            type: 'error',
            message: 'Unable to generate suggestions due to invalid data.',
          },
        ];
      }

      // Calculate how long it would take to reach the goal at current rate
      const monthsToGoal = monthlySavings > 0 ? Math.ceil(remaining / monthlySavings) : Infinity;

      // Check if goal has a deadline
      if (deadline && deadline instanceof Date && !isNaN(deadline.getTime())) {
        const monthsUntilDeadline = differenceInMonths(deadline, new Date());

        // Suggestion 1: If won't reach goal by deadline
        if (isFinite(monthsUntilDeadline) && monthsToGoal > monthsUntilDeadline && monthsUntilDeadline > 0) {
          const requiredMonthlySavings = remaining / monthsUntilDeadline;
          const additionalSavingsNeeded = requiredMonthlySavings - monthlySavings;

          if (isFinite(additionalSavingsNeeded) && additionalSavingsNeeded > 0) {
            suggestions.push({
              type: 'increaseSavings',
              message: `Increase monthly savings by ${additionalSavingsNeeded.toFixed(2)} to reach goal by deadline.`,
              additionalAmount: additionalSavingsNeeded,
            });
          }
        }
      }

      // Suggestion 2: Identify categories to reduce spending
      if (transactions.length > 0 && monthlySavings < remaining / 12) {
        // Group expenses by category
        const categoryExpenses = {};
        transactions.forEach((t) => {
          if (t.type === 'expense' && t.category) {
            if (!categoryExpenses[t.category]) {
              categoryExpenses[t.category] = 0;
            }
            const amount = isFinite(t.amount) ? t.amount : 0;
            categoryExpenses[t.category] += amount;
          }
        });

        // Find top 3 expense categories
        const topCategories = Object.entries(categoryExpenses)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);

        if (topCategories.length > 0) {
          suggestions.push({
            type: 'reduceExpenses',
            message: `Consider reducing expenses in top categories: ${topCategories.map((c) => c[0]).join(', ')}`,
            categories: topCategories,
          });
        }
      }

      // Suggestion 3: Adjust the goal if it seems unrealistic
      if (monthsToGoal > 36) {
        suggestions.push({
          type: 'adjustGoal',
          message: 'Consider setting a more achievable goal amount or extending your timeline.',
          currentMonthsToGoal: Math.min(monthsToGoal, 240), // Cap at 20 years for display
        });
      }

      return suggestions;
    } catch (error) {
      console.error('Error generating adjustment suggestions:', error);
      return [
        {
          type: 'error',
          message: 'Unable to generate suggestions due to an unexpected error.',
        },
      ];
    }
  }

  _calculateVariability(series) {
    if (series.length < 2) return 0;
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const variance = series.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / series.length;
    return Math.sqrt(variance);
  }

  _createDefaultForecast(months) {
    return Array.from({ length: months }, (_, i) => {
      // Create valid Date object for forecasting
      const forecastDate = new Date();
      forecastDate.setDate(1); // First day of month
      forecastDate.setHours(0, 0, 0, 0); // Midnight
      forecastDate.setMonth(forecastDate.getMonth() + i + 1); // Future month

      const monthName = format(forecastDate, 'MMMM');

      // Default values for income and expense
      const defaultExpense = 0;
      const defaultIncome = 0;
      // Calculate balance as income - expense (can be negative)
      const projectedBalance = defaultIncome - defaultExpense;

      return {
        date: forecastDate,
        projectedExpense: defaultExpense,
        projectedIncome: defaultIncome,
        projectedBalance,
        confidenceIntervals: {
          expense: { lower: 0, upper: 0 },
          income: { lower: 0, upper: 0 },
        },
        riskAssessment: 50,
        month: monthName,
        adjustmentFactors: {
          seasonality: 0,
          trend: 0,
          category: 0,
          economic: 0,
        },
      };
    });
  }

  _createDefaultGoalForecast(activeGoal) {
    return {
      goalId: activeGoal._id,
      goalName: activeGoal.name,
      currentAmount: activeGoal.currentAmount,
      targetAmount: activeGoal.targetAmount,
      monthsToGoal: null,
      projectedDate: null,
      monthlySavings: 0,
      savingsVolatility: 1,
      probability: 0,
      isAchievable: false,
      milestones: [],
      adjustmentSuggestions: [
        {
          type: 'noData',
          message: 'Add transactions to generate an accurate goal forecast.',
        },
      ],
    };
  }

  _groupTransactionsByMonth(transactions) {
    const months = {};

    transactions.forEach((transaction) => {
      const monthKey = format(new Date(transaction.date), 'yyyy-MM');

      if (!months[monthKey]) {
        months[monthKey] = {
          incomes: 0,
          expenses: 0,
          net: 0,
          transactions: [],
        };
      }

      if (transaction.type === 'income') {
        months[monthKey].incomes += transaction.amount;
      } else if (transaction.type === 'expense') {
        months[monthKey].expenses += transaction.amount;
      }

      months[monthKey].transactions.push(transaction);
    });

    Object.keys(months).forEach((month) => {
      months[month].net = months[month].incomes - months[month].expenses;
    });

    return months;
  }

  // New method to get transactions from the last N days
  async prepareRecentTransactionData(userId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const transactions = await TransactionCollection.aggregate([
      {
        $match: {
          userId,
          date: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: null,
          totalExpense: {
            $sum: {
              $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0],
            },
          },
          totalIncome: {
            $sum: {
              $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0],
            },
          },
          transactionCount: { $sum: 1 },
          expenseCategories: {
            $addToSet: {
              $cond: [{ $eq: ['$type', 'expense'] }, '$category', null],
            },
          },
          incomeCategories: {
            $addToSet: {
              $cond: [{ $eq: ['$type', 'income'] }, '$category', null],
            },
          },
        },
      },
    ]);

    // Default values if no transactions found
    if (!transactions || transactions.length === 0) {
      return {
        totalExpense: 0,
        totalIncome: 0,
        transactionCount: 0,
        expenseCategories: [],
        incomeCategories: [],
        daysAnalyzed: days,
      };
    }

    // Clean up categories (remove null values)
    const expenseCategories = transactions[0].expenseCategories.filter((cat) => cat !== null);
    const incomeCategories = transactions[0].incomeCategories.filter((cat) => cat !== null);

    // Convert total to daily average and then project to monthly
    const dailyExpense = transactions[0].totalExpense / days;
    const dailyIncome = transactions[0].totalIncome / days;
    const monthlyExpense = dailyExpense * 30;
    const monthlyIncome = dailyIncome * 30;

    return {
      totalExpense: monthlyExpense, // Projected to monthly amount
      totalIncome: monthlyIncome, // Projected to monthly amount
      rawExpense: transactions[0].totalExpense,
      rawIncome: transactions[0].totalIncome,
      transactionCount: transactions[0].transactionCount,
      expenseCategories,
      incomeCategories,
      daysAnalyzed: days,
      dailyExpense,
      dailyIncome,
    };
  }

  // New method to calculate predictions based on recent data
  _calculateRecentBasedPrediction(recentTotal, historicalSeries, categories, monthIndex, trendsData) {
    if (!isFinite(recentTotal) || recentTotal <= 0) {
      // Fallback to historical data if no recent data
      return this._enhancedStatisticalPrediction(historicalSeries, categories, monthIndex, trendsData);
    }

    // Use recent total as the base
    let baseAmount = recentTotal;

    // Apply seasonal pattern if we have enough historical data
    if (historicalSeries && historicalSeries.length >= 12) {
      const monthlyAverage = this._calculateMonthlyAverage(historicalSeries, monthIndex);
      const overallAverage = historicalSeries.reduce((sum, val) => sum + val, 0) / historicalSeries.length;

      if (overallAverage > 0 && monthlyAverage > 0) {
        // Calculate seasonal factor (how this month compares to yearly average)
        const seasonalFactor = monthlyAverage / overallAverage;
        // Apply seasonal adjustment to recent data
        baseAmount = baseAmount * seasonalFactor;
      }
    }

    // Apply recent trend if available
    if (trendsData && trendsData.length > 0) {
      const recentTrendData = trendsData.slice(-3);
      const avgGrowth =
        recentTrendData.reduce((sum, t) => {
          // Use the appropriate growth rate based on whether we're predicting expenses or income
          const growthRate = historicalSeries === trendsData.expenses ? t.expenseGrowth : t.incomeGrowth;
          return sum + (isFinite(growthRate) ? growthRate : 0);
        }, 0) / recentTrendData.length;

      // Apply a small growth adjustment based on recent trends
      if (isFinite(avgGrowth)) {
        baseAmount = baseAmount * (1 + avgGrowth * 0.5); // Dampen the growth effect
      }
    }

    return Math.max(baseAmount, 0);
  }

  // Method to get user data for default expense/income
  async _getUserData(userId) {
    try {
      // Use the direct import instead of model() to avoid errors
      const { UserCollection } = await import('../db/models/User.js');
      const user = await UserCollection.findById(userId);

      if (!user) return null;

      return {
        balance: user.balance || 10000, // Default balance if not set
        currency: user.currency || 'UAH',
        averageMonthlyIncome: user.averageMonthlyIncome || 1200,
        averageMonthlyExpense: user.averageMonthlyExpense || 1000,
        lastBalanceUpdate: user.lastBalanceUpdate,
      };
    } catch (error) {
      console.error('Error fetching user data:', error);
      // Return default values if user data fetch fails
      return {
        balance: 10000,
        currency: 'UAH',
        averageMonthlyIncome: 1200,
        averageMonthlyExpense: 1000,
        lastBalanceUpdate: new Date(),
      };
    }
  }

  // Create default forecast with baseline values
  _createDefaultForecastWithBaseline(months, baselineExpense = 1000, baselineIncome = 1200) {
    return Array.from({ length: months }, (_, i) => {
      // Create valid Date object for forecasting
      const forecastDate = new Date();
      forecastDate.setDate(1); // First day of month
      forecastDate.setHours(0, 0, 0, 0); // Midnight
      forecastDate.setMonth(forecastDate.getMonth() + i + 1); // Future month

      const monthName = format(forecastDate, 'MMMM');

      // Default values for income and expense
      const defaultExpense = baselineExpense;
      const defaultIncome = baselineIncome;

      // Apply some slight variation for each month to make it more realistic
      const variationFactor = 0.9 + Math.random() * 0.2; // 0.9 to 1.1
      const monthlyExpense = defaultExpense * variationFactor;
      const monthlyIncome = defaultIncome * variationFactor;

      // Calculate balance as income - expense (can be negative)
      const projectedBalance = monthlyIncome - monthlyExpense;

      return {
        date: forecastDate,
        projectedExpense: monthlyExpense,
        projectedIncome: monthlyIncome,
        projectedBalance,
        confidenceIntervals: {
          expense: { lower: monthlyExpense * 0.8, upper: monthlyExpense * 1.2 },
          income: { lower: monthlyIncome * 0.8, upper: monthlyIncome * 1.2 },
        },
        riskAssessment: 50,
        month: monthName,
        adjustmentFactors: {
          seasonality: 0,
          trend: 0,
          category: 0,
          economic: Math.random() * 0.1 - 0.05, // Small random factor between -0.05 and 0.05
        },
      };
    });
  }
}

export default new AdvancedAIForecastService();
