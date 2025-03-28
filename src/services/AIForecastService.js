import { ForecastCollection } from '../db/models/Forecast.js';
import { GoalCollection } from '../db/models/Goal.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import * as tf from '@tensorflow/tfjs';
import { addMonths, subMonths, differenceInMonths, format, parse, isLastDayOfMonth, getDaysInMonth } from 'date-fns';

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

    const data = await this.prepareForecastData(userId);

    let useNeuralModel = data.expenses.length >= 12;
    let modelPredictions = null;

    if (useNeuralModel) {
      try {
        modelPredictions = await this._getModelPredictions(data, userId);
      } catch (err) {
        console.error('Neural model prediction failed, falling back to statistical methods:', err);
        useNeuralModel = false;
      }
    }

    const forecastMonths = 12;
    const experimentalForecast = Array.from({ length: forecastMonths }, (_, i) => {
      const date = addMonths(new Date(), i + 1);
      const monthIndex = i % 12;

      let predictedExpense, predictedIncome;

      if (useNeuralModel && modelPredictions) {
        predictedExpense = modelPredictions.expenses[i];
        predictedIncome = modelPredictions.incomes[i];
      } else {
        predictedExpense = this._enhancedStatisticalPrediction(
          data.expenses,
          data.categories,
          monthIndex,
          data.trendsData,
        );
        predictedIncome = this._enhancedStatisticalPrediction(
          data.incomes,
          data.categories,
          monthIndex,
          data.trendsData,
        );
      }

      const seasonalityFactor = this._calculateSeasonalityFactor(data.expenses, monthIndex);
      const trendFactor = this._calculateTrendFactor(data.expenses);

      const categoryAdjustment = this._calculateCategoryBasedAdjustment(data.processedTransactions, monthIndex);

      const economicAdjustment = this._simulateEconomicIndicatorsAdjustment(i);

      const adjustmentFactors = 1 + seasonalityFactor + trendFactor + categoryAdjustment + economicAdjustment;

      const adjustedExpense = predictedExpense * adjustmentFactors;
      const adjustedIncome = predictedIncome * adjustmentFactors;

      const projectedBalance = Math.max(0, adjustedIncome - adjustedExpense);

      const { lowerExpense, upperExpense } = this._calculateConfidenceInterval(adjustedExpense, data.expenses);
      const { lowerIncome, upperIncome } = this._calculateConfidenceInterval(adjustedIncome, data.incomes);

      return {
        date,
        projectedExpense: Math.max(adjustedExpense, 0),
        projectedIncome: Math.max(adjustedIncome, 0),
        projectedBalance,
        confidenceIntervals: {
          expense: { lower: lowerExpense, upper: upperExpense },
          income: { lower: lowerIncome, upper: upperIncome },
        },
        riskAssessment: this._calculateEnhancedRiskScore(adjustedExpense, adjustedIncome, data.trendsData),
        month: format(date, 'MMMM'),
        adjustmentFactors: {
          seasonality: seasonalityFactor,
          trend: trendFactor,
          category: categoryAdjustment,
          economic: economicAdjustment,
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
    const mean = historicalData.reduce((a, b) => a + b, 0) / historicalData.length;
    const variance = historicalData.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / historicalData.length;
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
    const balanceRatio = income / (expense || 1);

    let volatilityFactor = 0;
    if (trendsData && trendsData.length >= 3) {
      const recentTrends = trendsData.slice(-3);
      const expenseVolatility = Math.abs(recentTrends.reduce((sum, t) => sum + t.expenseGrowth, 0) / 3);
      const incomeVolatility = Math.abs(recentTrends.reduce((sum, t) => sum + t.incomeGrowth, 0) / 3);
      volatilityFactor = (expenseVolatility + incomeVolatility) / 2;
    }

    const baseRisk = Math.min(Math.max((1 - balanceRatio) * 100, 0), 100);
    const volatilityRisk = volatilityFactor * 20;

    return Math.min(baseRisk + volatilityRisk, 100);
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
      const historicalData = await this.prepareForecastData(userId, 24);

      forecastData.details = {
        historicalExpenses: historicalData.expenses,
        historicalIncomes: historicalData.incomes,
        historicalDates: historicalData.dates,
        categoryDistribution: this._calculateCategoryDistribution(historicalData.processedTransactions),
        volatilityMetrics: this._calculateVolatilityMetrics(historicalData.trendsData),
        seasonalPatterns: this._identifySeasonalPatterns(historicalData.expenses, historicalData.incomes),
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

    const activeGoal = await GoalCollection.findOne({
      userId,
      isActive: true,
    });

    if (!activeGoal) return null;

    const pastMonths = 6;
    const transactions = await TransactionCollection.find({
      userId,
      date: { $gte: addMonths(new Date(), -pastMonths) },
    }).sort({ date: 1 });

    if (!transactions.length) {
      return this._createDefaultGoalForecast(activeGoal);
    }

    const monthlyTransactions = this._groupTransactionsByMonth(transactions);

    const monthlySavings = this._calculateWeightedMonthlySavings(monthlyTransactions);

    const savingsVolatility = this._calculateSavingsVolatility(monthlyTransactions);

    const remaining = activeGoal.targetAmount - activeGoal.currentAmount;

    let monthsToGoal;
    let projectedDate;

    if (monthlySavings <= 0) {
      monthsToGoal = Infinity;
      projectedDate = null;
    } else {
      const volatilityAdjustedSavings = monthlySavings * (1 - savingsVolatility * 0.5);
      monthsToGoal = Math.max(1, Math.ceil(remaining / Math.abs(volatilityAdjustedSavings)));
      projectedDate = addMonths(new Date(), monthsToGoal);
    }

    const achievabilityScore = this._calculateEnhancedGoalAchievabilityScore(
      monthlySavings,
      remaining,
      activeGoal.targetAmount,
      savingsVolatility,
      activeGoal.deadline ? differenceInMonths(activeGoal.deadline, new Date()) : null,
    );

    const milestones = this._calculateGoalMilestones(
      activeGoal.currentAmount,
      activeGoal.targetAmount,
      monthlySavings,
      savingsVolatility,
    );

    const goalForecast = {
      goalId: activeGoal._id,
      goalName: activeGoal.name,
      currentAmount: activeGoal.currentAmount,
      targetAmount: activeGoal.targetAmount,
      monthsToGoal: Number.isFinite(monthsToGoal) ? monthsToGoal : null,
      projectedDate,
      monthlySavings: Math.abs(monthlySavings),
      savingsVolatility,
      probability: achievabilityScore,
      isAchievable: achievabilityScore > 25,
      milestones,
      adjustmentSuggestions: this._generateAdjustmentSuggestions(
        monthlySavings,
        remaining,
        activeGoal.deadline,
        transactions,
      ),
    };

    this.goalCalculationCache.set(cacheKey, {
      data: goalForecast,
      timestamp: Date.now(),
    });

    return goalForecast;
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

  _calculateWeightedMonthlySavings(monthlyTransactions) {
    const monthKeys = Object.keys(monthlyTransactions).sort();

    if (monthKeys.length === 0) return 0;

    const weights = monthKeys.map((_, i) => Math.pow(1.5, i));
    const weightSum = weights.reduce((a, b) => a + b, 0);

    let weightedSavings = 0;
    monthKeys.forEach((month, i) => {
      weightedSavings += monthlyTransactions[month].net * weights[i];
    });

    return weightedSavings / weightSum;
  }

  _calculateSavingsVolatility(monthlyTransactions) {
    const monthKeys = Object.keys(monthlyTransactions).sort();

    if (monthKeys.length < 2) return 1;

    const netSavings = monthKeys.map((month) => monthlyTransactions[month].net);
    const avgSavings = netSavings.reduce((a, b) => a + b, 0) / netSavings.length;

    const squaredDiffs = netSavings.map((net) => Math.pow(net - avgSavings, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / netSavings.length;
    const stdDev = Math.sqrt(variance);

    const volatility = Math.abs(avgSavings) < 0.1 ? 1 : stdDev / Math.abs(avgSavings);

    return Math.min(Math.max(volatility, 0), 1);
  }

  _calculateEnhancedGoalAchievabilityScore(monthlySavings, remaining, targetAmount, volatility, monthsUntilDeadline) {
    const baseProbability = (monthlySavings / (remaining || 1)) * 100;

    const adjustments = [];

    const volatilityPenalty = volatility * 30;
    adjustments.push(-volatilityPenalty);

    const targetSizeFactor = Math.min((monthlySavings * 12) / targetAmount, 1) * 20;
    adjustments.push(targetSizeFactor);

    const progressBonus = ((targetAmount - remaining) / targetAmount) * 15;
    adjustments.push(progressBonus);

    let deadlinePenalty = 0;
    if (monthsUntilDeadline !== null) {
      const expectedMonths = monthlySavings > 0 ? remaining / monthlySavings : Infinity;

      if (Number.isFinite(expectedMonths) && Number.isFinite(monthsUntilDeadline)) {
        deadlinePenalty = monthsUntilDeadline >= expectedMonths ? 0 : -40 * (1 - monthsUntilDeadline / expectedMonths);
      } else {
        deadlinePenalty = -40;
      }
    }
    adjustments.push(deadlinePenalty);

    const adjustedProbability = baseProbability + adjustments.reduce((a, b) => a + b, 0);

    return Math.min(Math.max(adjustedProbability, 0), 100);
  }

  _calculateGoalMilestones(currentAmount, targetAmount, monthlySavings, volatility) {
    if (monthlySavings <= 0) return [];

    const milestones = [];
    const remaining = targetAmount - currentAmount;

    const milestonePercentages = [25, 50, 75, 90, 100];

    milestonePercentages.forEach((percentage) => {
      const milestoneAmount = targetAmount * (percentage / 100);

      if (milestoneAmount <= currentAmount) return;

      const amountNeeded = milestoneAmount - currentAmount;

      const volatilityAdjustedSavings = monthlySavings * (1 - volatility * 0.3);
      const estimatedMonths = Math.ceil(amountNeeded / volatilityAdjustedSavings);

      const projectedDate = addMonths(new Date(), estimatedMonths);

      milestones.push({
        percentage,
        amount: milestoneAmount,
        estimatedMonths,
        projectedDate,
        amountNeeded,
      });
    });

    return milestones;
  }

  _generateAdjustmentSuggestions(monthlySavings, remaining, deadline, transactions) {
    const suggestions = [];

    const monthsToGoal = monthlySavings > 0 ? Math.ceil(remaining / monthlySavings) : Infinity;

    if (deadline) {
      const monthsUntilDeadline = differenceInMonths(deadline, new Date());

      if (monthsToGoal > monthsUntilDeadline) {
        const requiredMonthlySavings = remaining / monthsUntilDeadline;
        const additionalSavingsNeeded = requiredMonthlySavings - monthlySavings;

        suggestions.push({
          type: 'increaseSavings',
          message: `Increase monthly savings by ${additionalSavingsNeeded.toFixed(2)} to reach goal by deadline.`,
          additionalAmount: additionalSavingsNeeded,
        });
      }
    }

    if (transactions.length > 0 && monthlySavings < remaining / 12) {
      const categoryExpenses = {};
      transactions.forEach((t) => {
        if (t.type === 'expense') {
          if (!categoryExpenses[t.category]) {
            categoryExpenses[t.category] = 0;
          }
          categoryExpenses[t.category] += t.amount;
        }
      });

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

    if (monthsToGoal > 36) {
      suggestions.push({
        type: 'adjustGoal',
        message: 'Consider setting a more achievable goal amount or extending your timeline.',
        currentMonthsToGoal: monthsToGoal,
      });
    }

    return suggestions;
  }

  _calculateGoalAchievementProbability(monthlySavings, remaining, targetAmount) {
    const achievementFactor = monthlySavings / (remaining || 1);
    return Math.min(Math.max(achievementFactor * 100, 0), 100);
  }

  _calculateVariability(series) {
    if (series.length < 2) return 0;
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const variance = series.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / series.length;
    return Math.sqrt(variance);
  }
}

export default new AdvancedAIForecastService();
