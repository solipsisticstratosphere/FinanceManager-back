import { ForecastCollection } from '../db/models/Forecast.js';
import { GoalCollection } from '../db/models/Goal.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import * as tf from '@tensorflow/tfjs';
import { addMonths, subMonths, format, differenceInMonths, parseISO, isValid } from 'date-fns';

class AdvancedAIForecastService {
  constructor() {
    this.forecastCache = new Map();
    this.goalCalculationCache = new Map();
    this.MODEL_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours
    this.trainedModels = new Map(); // Cache for trained TensorFlow models
  }

  async prepareForecastData(userId, numMonths = 36) {
    // Extended to 36 months for better pattern recognition
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
          // Additional data for improved analysis
          categoryBreakdown: {
            $push: {
              $cond: [{ $ne: ['$category', null] }, { category: '$category', amount: '$amount', type: '$type' }, null],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Process category data for more detailed analysis
    const categoryData = {};
    transactions.forEach((t) => {
      const validCategories = t.categoryBreakdown.filter((c) => c !== null);
      validCategories.forEach((c) => {
        if (!categoryData[c.category]) {
          categoryData[c.category] = {
            type: c.type,
            amounts: Array(transactions.length).fill(0),
          };
        }
        const index = transactions.findIndex((tr) => tr._id === t._id);
        if (index !== -1) {
          categoryData[c.category].amounts[index] += c.amount;
        }
      });
    });

    return {
      expenses: transactions.map((t) => t.expenses),
      incomes: transactions.map((t) => t.incomes),
      dates: transactions.map((t) => t._id),
      transactionCounts: transactions.map((t) => t.transactionCount),
      categories: transactions.flatMap((t) => t.categories),
      categoryData,
      rawTransactions: transactions,
    };
  }

  async predictFinancialForecast(userId) {
    const cacheKey = `forecast_${userId}`;
    const cachedForecast = this.forecastCache.get(cacheKey);

    if (cachedForecast && Date.now() - cachedForecast.timestamp < this.MODEL_CACHE_DURATION) {
      return cachedForecast.data;
    }

    const data = await this.prepareForecastData(userId);

    // Detect and remove outliers for more accurate predictions
    const cleanedExpenses = this._removeOutliers(data.expenses);
    const cleanedIncomes = this._removeOutliers(data.incomes);

    // Train TensorFlow models if needed
    await this._trainOrGetModel(userId, cleanedExpenses, 'expense', data.dates);
    await this._trainOrGetModel(userId, cleanedIncomes, 'income', data.dates);

    const forecastMonths = 12;
    const experimentalForecast = await Promise.all(
      Array.from({ length: forecastMonths }, async (_, i) => {
        const date = addMonths(new Date(), i + 1);
        const monthStr = format(date, 'yyyy-MM');

        // Get category-based predictions for more accuracy
        const categoryPredictions = await this._predictCategories(data.categoryData, i, data.dates);

        // Use TensorFlow for expense/income predictions
        let predictedExpense = await this._tfPredict(userId, 'expense', i + 1);
        let predictedIncome = await this._tfPredict(userId, 'income', i + 1);

        // Fallback to statistical prediction if TF model is not reliable
        if (!predictedExpense || predictedExpense <= 0) {
          predictedExpense = this._arimaBasedPrediction(cleanedExpenses, i);
        }

        if (!predictedIncome || predictedIncome <= 0) {
          predictedIncome = this._arimaBasedPrediction(cleanedIncomes, i);
        }

        // Apply advanced seasonality and trend corrections
        const seasonalityFactor = this._calculateAdvancedSeasonalityFactor(cleanedExpenses, i, data.dates);
        const expenseTrendFactor = this._calculateAdvancedTrendFactor(cleanedExpenses);
        const incomeTrendFactor = this._calculateAdvancedTrendFactor(cleanedIncomes);

        // Calculate with confidence intervals for better risk assessment
        const { adjustedExpense, expenseConfidence } = this._adjustWithConfidence(
          predictedExpense,
          seasonalityFactor,
          expenseTrendFactor,
          'expense',
        );

        const { adjustedIncome, incomeConfidence } = this._adjustWithConfidence(
          predictedIncome,
          seasonalityFactor,
          incomeTrendFactor,
          'income',
        );

        const projectedBalance = Math.max(0, adjustedIncome - adjustedExpense);
        const balanceConfidence = (expenseConfidence + incomeConfidence) / 2;

        return {
          date,
          monthStr,
          projectedExpense: Math.max(adjustedExpense, 0),
          projectedIncome: Math.max(adjustedIncome, 0),
          projectedBalance,
          categoryPredictions,
          confidence: {
            expense: expenseConfidence,
            income: incomeConfidence,
            balance: balanceConfidence,
          },
          riskAssessment: this._calculateEnhancedRiskScore(
            adjustedExpense,
            adjustedIncome,
            expenseConfidence,
            incomeConfidence,
          ),
        };
      }),
    );

    this.forecastCache.set(cacheKey, {
      data: experimentalForecast,
      timestamp: Date.now(),
    });

    return experimentalForecast;
  }

  async _trainOrGetModel(userId, series, type, dates) {
    const modelKey = `model_${userId}_${type}`;
    if (
      this.trainedModels.has(modelKey) &&
      Date.now() - this.trainedModels.get(modelKey).timestamp < this.MODEL_CACHE_DURATION
    ) {
      return this.trainedModels.get(modelKey).model;
    }

    // Prepare data for TensorFlow
    // Convert dates to numerical values for training
    const dateValues = dates.map((d, i) => i);

    if (series.length < 6) {
      // Not enough data for reliable model
      return null;
    }

    try {
      // Normalize data
      const { normalizedData, min, max } = this._normalizeData(series);

      // Create tensor datasets
      const xs = tf.tensor2d(
        dateValues.map((d) => [d]),
        [dateValues.length, 1],
      );
      const ys = tf.tensor2d(
        normalizedData.map((v) => [v]),
        [normalizedData.length, 1],
      );

      // Create and train the model
      const model = tf.sequential();
      model.add(tf.layers.dense({ units: 10, inputShape: [1], activation: 'relu' }));
      model.add(tf.layers.dense({ units: 10, activation: 'relu' }));
      model.add(tf.layers.dense({ units: 1 }));

      model.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'meanSquaredError',
      });

      await model.fit(xs, ys, {
        epochs: 100,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (epoch % 20 === 0) {
              console.log(`Training model for ${type}, epoch ${epoch}: loss = ${logs.loss}`);
            }
          },
        },
      });

      // Cache the trained model
      this.trainedModels.set(modelKey, {
        model,
        timestamp: Date.now(),
        metadata: { min, max },
      });

      return model;
    } catch (error) {
      console.error(`Error training model for ${type}:`, error);
      return null;
    }
  }

  async _tfPredict(userId, type, monthsAhead) {
    const modelKey = `model_${userId}_${type}`;
    if (!this.trainedModels.has(modelKey)) {
      return null;
    }

    const { model, metadata } = this.trainedModels.get(modelKey);
    const { min, max } = metadata;

    try {
      // Use the last data point index + monthsAhead as input
      const lastIndex = this.trainedModels.get(modelKey).metadata.lastIndex || 0;
      const input = tf.tensor2d([[lastIndex + monthsAhead]]);

      // Get prediction
      const predictionNormalized = model.predict(input);
      const predictionValue = predictionNormalized.dataSync()[0];

      // Denormalize to get actual value
      return predictionValue * (max - min) + min;
    } catch (error) {
      console.error(`Error predicting with TF model for ${type}:`, error);
      return null;
    }
  }

  _normalizeData(data) {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1; // Prevent division by zero

    return {
      normalizedData: data.map((x) => (x - min) / range),
      min,
      max,
    };
  }

  _removeOutliers(series) {
    if (series.length < 4) return series; // Need enough data for reliable outlier detection

    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const stdDev = Math.sqrt(series.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / series.length);

    // Use 2.5 standard deviations as threshold for outliers (more forgiving than 2)
    const threshold = 2.5 * stdDev;

    return series.map((value) => {
      if (Math.abs(value - mean) > threshold) {
        // Replace outlier with interpolated value
        return mean + Math.sign(value - mean) * threshold;
      }
      return value;
    });
  }

  async _predictCategories(categoryData, monthOffset, dates) {
    const predictions = {};

    for (const [category, data] of Object.entries(categoryData)) {
      // Apply time series forecasting to individual categories
      const prediction = this._arimaBasedPrediction(data.amounts, monthOffset);
      const seasonalFactor = this._calculateAdvancedSeasonalityFactor(data.amounts, monthOffset, dates);
      const trendFactor = this._calculateAdvancedTrendFactor(data.amounts);

      // Adjust prediction with seasonality and trend
      const adjustedPrediction = prediction * (1 + seasonalFactor + trendFactor);

      predictions[category] = {
        amount: Math.max(adjustedPrediction, 0),
        type: data.type,
      };
    }

    return predictions;
  }

  _arimaBasedPrediction(series, monthOffset) {
    if (series.length === 0) return 1;

    const validSeries = series.filter((val) => !isNaN(val) && val !== 0);
    if (validSeries.length === 0) return 1;

    // AR component: Weighted average of past values
    const arOrder = Math.min(6, Math.floor(validSeries.length / 3));
    let arComponent = 0;
    let weightSum = 0;

    for (let i = 1; i <= arOrder; i++) {
      const index = validSeries.length - i;
      const weight = (arOrder - i + 1) / arOrder; // Higher weights for more recent values

      if (index >= 0) {
        arComponent += validSeries[index] * weight;
        weightSum += weight;
      }
    }

    arComponent = weightSum > 0 ? arComponent / weightSum : validSeries[validSeries.length - 1];

    // MA component: Moving average of errors
    const errors = [];
    const maOrder = Math.min(3, Math.floor(validSeries.length / 4));

    for (let i = maOrder; i < validSeries.length; i++) {
      const predicted = validSeries.slice(i - maOrder, i).reduce((a, b) => a + b, 0) / maOrder;
      errors.push(validSeries[i] - predicted);
    }

    const maComponent = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;

    // I component: Check if differencing is needed (trend detection)
    let differenced = [];
    for (let i = 1; i < validSeries.length; i++) {
      differenced.push(validSeries[i] - validSeries[i - 1]);
    }

    const meanDiff = differenced.length > 0 ? differenced.reduce((a, b) => a + b, 0) / differenced.length : 0;

    // Final prediction combining AR, I and MA components
    const prediction = arComponent + maComponent + meanDiff * monthOffset;

    // Adjust for confidence based on data size
    const confidenceFactor = Math.min(1, validSeries.length / 12);
    const mean = validSeries.reduce((a, b) => a + b, 0) / validSeries.length;

    return prediction * confidenceFactor + mean * (1 - confidenceFactor);
  }

  _adjustWithConfidence(prediction, seasonalityFactor, trendFactor, type = 'expense') {
    const adjustedValue = prediction * (1 + seasonalityFactor + trendFactor);

    // Calculate confidence level based on factors
    const factorMagnitude = Math.abs(seasonalityFactor) + Math.abs(trendFactor);
    // Higher factor magnitude = lower confidence
    const confidenceScore = Math.max(0, Math.min(100, 100 - factorMagnitude * 50));

    if (type === 'expense') {
      return {
        adjustedExpense: Math.max(adjustedValue, 0),
        expenseConfidence: confidenceScore,
      };
    } else {
      return {
        adjustedIncome: Math.max(adjustedValue, 0),
        incomeConfidence: confidenceScore,
      };
    }
  }

  _calculateAdvancedSeasonalityFactor(series, monthOffset, dates) {
    if (series.length < 12) return 0;

    // Get target month's historical pattern
    const targetMonth = format(addMonths(new Date(), monthOffset + 1), 'MM');
    const monthlyPatterns = {};

    // Group historical data by month
    dates.forEach((dateStr, i) => {
      if (!isValid(parseISO(dateStr))) return;

      const month = dateStr.split('-')[1]; // Extract month from YYYY-MM
      if (!monthlyPatterns[month]) {
        monthlyPatterns[month] = [];
      }

      if (i < series.length) {
        monthlyPatterns[month].push(series[i]);
      }
    });

    // If we have data for target month, use it for seasonality
    if (monthlyPatterns[targetMonth] && monthlyPatterns[targetMonth].length > 0) {
      const monthAverage =
        monthlyPatterns[targetMonth].reduce((a, b) => a + b, 0) / monthlyPatterns[targetMonth].length;

      const overallAverage = series.reduce((a, b) => a + b, 0) / series.length;

      // Calculate seasonal ratio
      if (overallAverage > 0) {
        return monthAverage / overallAverage - 1; // How much above/below average
      }
    }

    // Fallback to sinusoidal approximation if no data for target month
    const seasonalPattern = series.slice(-12); // Last 12 months
    const avgSeasonal = seasonalPattern.reduce((a, b) => a + b, 0) / seasonalPattern.length;
    return Math.sin((monthOffset * Math.PI) / 6) * (avgSeasonal / (series[series.length - 1] || 1));
  }

  _calculateAdvancedTrendFactor(series) {
    if (series.length < 3) return 0;

    // Use exponential weighted moving average for trend detection
    // This gives more importance to recent data points
    let weights = 0;
    let sum = 0;

    // Calculate exponential weighted slope
    for (let i = 1; i < series.length; i++) {
      const weight = Math.exp(0.1 * (i - 1)); // Exponential weight
      const slope = (series[i] - series[i - 1]) / (series[i - 1] || 1); // Percent change
      sum += slope * weight;
      weights += weight;
    }

    const trend = weights > 0 ? sum / weights : 0;

    // Limit extreme values to avoid overreaction
    return Math.max(-0.3, Math.min(0.3, trend));
  }

  _calculateEnhancedRiskScore(expense, income, expenseConfidence, incomeConfidence) {
    const balanceRatio = income / (expense || 1);

    // Base risk assessment
    const baseRisk = Math.min(Math.max((1 - balanceRatio) * 100, 0), 100);

    // Adjust risk based on confidence scores
    // Lower confidence = higher risk
    const confidenceAdjustment = (100 - (expenseConfidence + incomeConfidence) / 2) * 0.3;

    // Calculate volatility risk
    const volatilityRisk = (100 - expenseConfidence) * 0.4;

    // Combine factors with different weights
    return Math.min(100, baseRisk * 0.6 + confidenceAdjustment + volatilityRisk * 0.3);
  }

  async updateForecasts(userId, session = null) {
    const budgetForecasts = await this.predictFinancialForecast(userId);
    const goalForecast = await this._calculateEnhancedGoalForecast(userId);

    const updateOperation = {
      budgetForecasts,
      goalForecast,
      lastUpdated: new Date(),
      forecastMethod: 'Advanced-AI-Enhanced-v3', // Updated version
      confidenceScore: this._calculateOverallConfidence(budgetForecasts),
    };

    if (session) {
      return ForecastCollection.findOneAndUpdate({ userId }, updateOperation, { upsert: true, new: true, session });
    }

    return ForecastCollection.findOneAndUpdate({ userId }, updateOperation, { upsert: true, new: true });
  }

  _calculateOverallConfidence(forecasts) {
    if (!forecasts || forecasts.length === 0) return 50;

    const confidenceScores = forecasts
      .slice(0, 3) // Focus on short-term forecasts which are more reliable
      .map((f) => (f.confidence.expense + f.confidence.income + f.confidence.balance) / 3);

    return confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;
  }

  async _calculateEnhancedGoalForecast(userId) {
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

    // Get more historical data for better analysis - 6 months instead of 3
    const transactions = await TransactionCollection.find({
      userId,
      date: { $gte: addMonths(new Date(), -6) },
    });

    // Calculate monthly savings with trend detection
    const monthlySavingsData = [];
    for (let i = 0; i < 6; i++) {
      const monthStart = addMonths(new Date(), -i - 1);
      const monthEnd = addMonths(new Date(), -i);

      const monthTransactions = transactions.filter((t) => t.date >= monthStart && t.date < monthEnd);

      const monthlySaving = monthTransactions.reduce(
        (acc, t) => (t.type === 'income' ? acc + t.amount : acc - t.amount),
        0,
      );

      monthlySavingsData.push(monthlySaving);
    }

    // Calculate weighted average with more emphasis on recent months
    let weightedSavings = 0;
    let weightSum = 0;

    for (let i = 0; i < monthlySavingsData.length; i++) {
      const weight = Math.exp(-0.4 * i); // Exponential decay weight
      weightedSavings += monthlySavingsData[i] * weight;
      weightSum += weight;
    }

    const avgMonthlySavings = weightSum > 0 ? weightedSavings / weightSum : 0;

    // Calculate savings variability for risk assessment
    const savingsVariability = this._calculateVariability(monthlySavingsData);

    const remaining = activeGoal.targetAmount - activeGoal.currentAmount;

    // Project with variance consideration
    const optimisticSavings = Math.max(avgMonthlySavings, avgMonthlySavings + savingsVariability);
    const pessimisticSavings = Math.max(1, avgMonthlySavings - savingsVariability);

    const bestCaseMonths = Math.max(1, Math.ceil(remaining / optimisticSavings));
    const worstCaseMonths =
      remaining > 0 && pessimisticSavings > 0 ? Math.ceil(remaining / pessimisticSavings) : Number.POSITIVE_INFINITY;

    const expectedMonths = Math.max(1, Math.ceil(remaining / Math.abs(avgMonthlySavings || 1)));
    const projectedDate = addMonths(new Date(), expectedMonths);

    // Calculate probability with more factors
    const probability = this._calculateEnhancedGoalProbability(
      Math.abs(avgMonthlySavings),
      remaining,
      activeGoal.targetAmount,
      savingsVariability,
      monthlySavingsData,
    );

    const goalForecast = {
      goalId: activeGoal._id,
      expectedMonthsToGoal: expectedMonths,
      bestCaseMonthsToGoal: bestCaseMonths,
      worstCaseMonthsToGoal: Math.min(120, worstCaseMonths), // Cap at 10 years for UI
      projectedDate,
      monthlySavings: Math.abs(avgMonthlySavings),
      savingsVariability,
      probability,
      riskFactors: this._assessGoalRiskFactors(avgMonthlySavings, savingsVariability, remaining, monthlySavingsData),
    };

    this.goalCalculationCache.set(cacheKey, {
      data: goalForecast,
      timestamp: Date.now(),
    });

    return goalForecast;
  }

  _calculateEnhancedGoalProbability(monthlySavings, remaining, targetAmount, variability, historicalSavings) {
    if (remaining <= 0) return 100; // Already achieved
    if (monthlySavings <= 0) return 0; // No savings

    // Base achievement factor
    const achievementFactor = monthlySavings / (remaining || 1);

    // Penalty for high variability
    const variabilityFactor = Math.min(1, 1 - (variability / (monthlySavings || 1)) * 0.5);

    // Trend analysis - are savings increasing or decreasing?
    let trendFactor = 0;
    if (historicalSavings.length >= 3) {
      const recentAvg = historicalSavings.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      const olderAvg =
        historicalSavings.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, historicalSavings.slice(3).length);

      trendFactor = recentAvg > olderAvg ? 0.2 : -0.1; // Bonus for improving trend
    }

    // Scale based on how ambitious the goal is compared to monthly savings
    const ambitiousFactor = Math.min(1, monthlySavings / (targetAmount * 0.1));

    // Combine all factors
    const probabilityScore =
      achievementFactor * 50 * variabilityFactor * (1 + trendFactor) * Math.sqrt(ambitiousFactor);

    return Math.min(Math.max(probabilityScore, 0), 100);
  }

  _assessGoalRiskFactors(monthlySavings, variability, remaining, historicalSavings) {
    const risks = [];

    // Assess savings consistency
    const variabilityRatio = variability / (monthlySavings || 1);
    if (variabilityRatio > 0.5) {
      risks.push({
        type: 'high_variability',
        severity: Math.min(100, variabilityRatio * 100),
        description: 'Your savings rate is highly variable',
      });
    }

    // Assess negative trend
    if (historicalSavings.length >= 4) {
      const recentAvg = historicalSavings.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
      const olderAvg = historicalSavings.slice(2, 4).reduce((a, b) => a + b, 0) / 2;

      if (recentAvg < olderAvg) {
        const trendSeverity = Math.min(100, ((olderAvg - recentAvg) / (olderAvg || 1)) * 100);
        risks.push({
          type: 'declining_savings',
          severity: trendSeverity,
          description: 'Your recent savings rate is declining',
        });
      }
    }

    // Assess if goal is too ambitious
    const monthsRequired = remaining / (monthlySavings || 1);
    if (monthsRequired > 36) {
      risks.push({
        type: 'ambitious_timeline',
        severity: Math.min(100, (monthsRequired - 36) * 2),
        description: 'Your goal may take a long time to achieve',
      });
    }

    // Assess negative months
    const negativeMonths = historicalSavings.filter((s) => s < 0).length;
    if (negativeMonths > 0) {
      risks.push({
        type: 'negative_months',
        severity: Math.min(100, (negativeMonths / historicalSavings.length) * 100),
        description: 'You had months with negative savings',
      });
    }

    return risks;
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
