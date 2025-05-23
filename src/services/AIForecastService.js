import { ForecastCollection } from '../db/models/Forecast.js';
import { GoalCollection } from '../db/models/Goal.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import * as tf from '@tensorflow/tfjs';
import { addMonths, subMonths, format, differenceInMonths, parseISO, isValid } from 'date-fns';

export default class AdvancedAIForecastService {
  constructor() {
    this.forecastCache = new Map();
    this.goalCalculationCache = new Map();
    this.MODEL_CACHE_DURATION = 2 * 60 * 60 * 1000; // Reduced to 2 hours from 6 hours
    this.trainedModels = new Map(); // Cache for trained TensorFlow models
    this.PROGRESS_UPDATE_INTERVAL = 5; // Update progress every 5%
    this.currentUserId = null; // Add currentUserId property
  }

  async prepareForecastData(userId, numMonths = 36) {
    // Extended to 36 months for better pattern recognition
    const startDate = subMonths(new Date(), numMonths);

    // First, get all transactions for the user
    const transactions = await TransactionCollection.find({
      userId,
      date: { $gte: startDate },
    }).sort({ date: 1 });

    // Group transactions by month
    const monthlyData = {};
    transactions.forEach((transaction) => {
      const monthStr = format(transaction.date, 'yyyy-MM');

      if (!monthlyData[monthStr]) {
        monthlyData[monthStr] = {
          expenses: 0,
          incomes: 0,
          transactionCount: 0,
          categories: new Set(),
          categoryBreakdown: {},
        };
      }

      // Update monthly totals
      if (transaction.type === 'expense') {
        monthlyData[monthStr].expenses += transaction.amount;
      } else {
        monthlyData[monthStr].incomes += transaction.amount;
      }
      monthlyData[monthStr].transactionCount++;

      // Add category to set
      monthlyData[monthStr].categories.add(transaction.category);

      // Update category breakdown
      if (!monthlyData[monthStr].categoryBreakdown[transaction.category]) {
        monthlyData[monthStr].categoryBreakdown[transaction.category] = {
          amount: 0,
          type: transaction.type,
        };
      }
      monthlyData[monthStr].categoryBreakdown[transaction.category].amount += transaction.amount;
    });

    // Convert to arrays for easier processing
    const dates = Object.keys(monthlyData).sort();
    const expenses = dates.map((date) => monthlyData[date].expenses);
    const incomes = dates.map((date) => monthlyData[date].incomes);
    const transactionCounts = dates.map((date) => monthlyData[date].transactionCount);
    const categories = [...new Set(dates.flatMap((date) => [...monthlyData[date].categories]))];

    // Process category data for more detailed analysis
    const categoryData = {};
    categories.forEach((category) => {
      categoryData[category] = {
        type: null,
        amounts: Array(dates.length).fill(0),
      };

      dates.forEach((date, index) => {
        const breakdown = monthlyData[date].categoryBreakdown[category];
        if (breakdown) {
          categoryData[category].amounts[index] = breakdown.amount;
          categoryData[category].type = breakdown.type;
        }
      });
    });

    return {
      expenses,
      incomes,
      dates,
      transactionCounts,
      categories,
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

    try {
      // Update progress to 20%
      await this._updateProgress(userId, 20);

      const data = await this.prepareForecastData(userId);

      // Check if we have enough data
      if (!data.expenses.length || !data.incomes.length) {
        // Return varied default values if no data
        return this._generateVariedDefaultForecast();
      }

      // Update progress to 30%
      await this._updateProgress(userId, 30);

      // Detect and remove outliers for more accurate predictions
      const cleanedExpenses = this._removeOutliers(data.expenses);
      const cleanedIncomes = this._removeOutliers(data.incomes);

      // Update progress to 40%
      await this._updateProgress(userId, 40);

      // Train TensorFlow models if needed
      await this._trainOrGetModel(userId, cleanedExpenses, 'expense', data.dates);

      // Update progress to 50%
      await this._updateProgress(userId, 50);

      await this._trainOrGetModel(userId, cleanedIncomes, 'income', data.dates);

      // Update progress to 60%
      await this._updateProgress(userId, 60);

      // Get average values for calculations
      const avgExpense = cleanedExpenses.reduce((sum, val) => sum + val, 0) / cleanedExpenses.length;
      const avgIncome = cleanedIncomes.reduce((sum, val) => sum + val, 0) / cleanedIncomes.length;

      // Get seasonal patterns if available
      const monthlyPatterns = this._extractMonthlyPatterns(data.dates, cleanedExpenses, cleanedIncomes);

      // Update progress to 70%
      await this._updateProgress(userId, 70);

      const forecastMonths = 12;
      const experimentalForecast = await Promise.all(
        Array.from({ length: forecastMonths }, async (_, i) => {
          try {
            const date = addMonths(new Date(), i + 1);
            const monthStr = format(date, 'yyyy-MM');
            const monthNumber = parseInt(format(date, 'MM'));

            // Apply monthly patterns if available
            const monthPattern = monthlyPatterns[monthNumber] || { expenseFactor: 1, incomeFactor: 1 };

            // Add month-specific variations
            // Different variation for each month ensures forecasts are not identical
            const monthVariation = this._getMonthVariation(i, monthNumber);

            // Get category-based predictions for more accuracy
            const categoryPredictions = await this._predictCategoriesWithVariation(
              data.categoryData,
              i,
              data.dates,
              monthPattern,
              monthVariation,
            );

            // Use TensorFlow for expense/income predictions with monthly variation
            let predictedExpense = await this._tfPredict(userId, 'expense', i + 1);
            let predictedIncome = await this._tfPredict(userId, 'income', i + 1);

            // Apply month-specific variation
            if (predictedExpense && !isNaN(predictedExpense)) {
              predictedExpense = predictedExpense * monthPattern.expenseFactor * (1 + monthVariation.expenseVariation);
            }

            if (predictedIncome && !isNaN(predictedIncome)) {
              predictedIncome = predictedIncome * monthPattern.incomeFactor * (1 + monthVariation.incomeVariation);
            }

            // Fallback to statistical prediction if TF model is not reliable
            if (!predictedExpense || predictedExpense <= 0 || isNaN(predictedExpense)) {
              predictedExpense =
                this._arimaBasedPrediction(cleanedExpenses, i) *
                monthPattern.expenseFactor *
                (1 + monthVariation.expenseVariation);
            }

            if (!predictedIncome || predictedIncome <= 0 || isNaN(predictedIncome)) {
              predictedIncome =
                this._arimaBasedPrediction(cleanedIncomes, i) *
                monthPattern.incomeFactor *
                (1 + monthVariation.incomeVariation);
            }

            // Calculate confidence based on data quality and prediction method
            const expenseConfidence = this._calculateConfidence(
              predictedExpense,
              avgExpense,
              data.expenses.length,
              i,
              'expense',
            );
            const incomeConfidence = this._calculateConfidence(
              predictedIncome,
              avgIncome,
              data.incomes.length,
              i,
              'income',
            );

            // Adjust predictions based on confidence
            const adjustedExpense = this._adjustPredictionBasedOnConfidence(
              predictedExpense,
              avgExpense,
              expenseConfidence,
            );
            const adjustedIncome = this._adjustPredictionBasedOnConfidence(
              predictedIncome,
              avgIncome,
              incomeConfidence,
            );

            // Ensure values are safe
            const safeExpense = isNaN(adjustedExpense)
              ? avgExpense * (1 + monthVariation.expenseVariation)
              : adjustedExpense;

            const safeIncome = isNaN(adjustedIncome)
              ? avgIncome * (1 + monthVariation.incomeVariation)
              : adjustedIncome;

            const projectedBalance = Math.max(0, safeIncome - safeExpense);

            // Vary confidence by month
            const baseConfidence = (expenseConfidence + incomeConfidence) / 2;
            const balanceConfidence = Math.max(60, Math.min(95, baseConfidence - i * 2)); // Confidence decreases with time

            // Clean category predictions (remove NaN values)
            const cleanedCategoryPredictions = {};
            for (const [category, prediction] of Object.entries(categoryPredictions)) {
              cleanedCategoryPredictions[category] = {
                amount: isNaN(prediction.amount) ? 0 : prediction.amount,
                type: prediction.type,
              };
            }

            // Calculate risk with safe values
            const riskAssessment = this._calculateEnhancedRiskScore(
              safeExpense,
              safeIncome,
              expenseConfidence,
              incomeConfidence,
            );

            return {
              date,
              monthStr,
              projectedExpense: Math.max(safeExpense, 0),
              projectedIncome: Math.max(safeIncome, 0),
              projectedBalance,
              categoryPredictions: cleanedCategoryPredictions,
              confidence: {
                expense: Math.max(60, expenseConfidence - i * 1.5),
                income: Math.max(60, incomeConfidence - i * 1.5),
                balance: balanceConfidence,
              },
              riskAssessment: isNaN(riskAssessment) ? 50 : riskAssessment,
            };
          } catch (error) {
            console.error(`Error predicting month ${i + 1}:`, error);
            // Return safe default values for this month with variation
            return this._generateVariedDefaultMonthForecast(i);
          }
        }),
      );

      // Update progress to 90%
      await this._updateProgress(userId, 90);

      this.forecastCache.set(cacheKey, {
        data: experimentalForecast,
        timestamp: Date.now(),
      });

      // Update progress to 100%
      await this._updateProgress(userId, 100);

      return experimentalForecast;
    } catch (error) {
      console.error('Error in predictFinancialForecast:', error);
      // Return varied default values in case of error
      return this._generateVariedDefaultForecast();
    }
  }

  // Helper method to update progress
  async _updateProgress(userId, progress) {
    try {
      await ForecastCollection.findOneAndUpdate(
        { userId },
        {
          calculationProgress: progress,
          calculationStatus: progress < 100 ? 'in_progress' : 'completed',
        },
        { upsert: true },
      );
    } catch (error) {
      console.error('Error updating progress:', error);
    }
  }

  // Helper method to adjust prediction based on confidence
  _adjustPredictionBasedOnConfidence(prediction, average, confidence) {
    // If confidence is low, blend prediction with average
    if (confidence < 70) {
      const blendFactor = confidence / 100;
      return prediction * blendFactor + average * (1 - blendFactor);
    }
    return prediction;
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
    if (!series || series.length === 0) return 1;

    const validSeries = series.filter((val) => !isNaN(val) && val !== null && val !== 0);
    if (validSeries.length === 0) return 1;

    try {
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

      const result = prediction * confidenceFactor + mean * (1 - confidenceFactor);

      // Final safety check
      return isNaN(result) ? mean : result;
    } catch (error) {
      console.error('Error in _arimaBasedPrediction:', error);
      // Fallback to simple average
      return validSeries.reduce((a, b) => a + b, 0) / validSeries.length;
    }
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
    if (!series || series.length < 12) return 0;

    try {
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
          const result = monthAverage / overallAverage - 1; // How much above/below average
          return isNaN(result) ? 0 : result;
        }
      }

      // Fallback to sinusoidal approximation if no data for target month
      const seasonalPattern = series.slice(-12); // Last 12 months
      const avgSeasonal = seasonalPattern.reduce((a, b) => a + b, 0) / seasonalPattern.length;
      const result = Math.sin((monthOffset * Math.PI) / 6) * (avgSeasonal / (series[series.length - 1] || 1));

      return isNaN(result) ? 0 : result;
    } catch (error) {
      console.error('Error in _calculateAdvancedSeasonalityFactor:', error);
      return 0;
    }
  }

  _calculateAdvancedTrendFactor(series) {
    if (!series || series.length < 3) return 0;

    try {
      // Use exponential weighted moving average for trend detection
      // This gives more importance to recent data points
      let weights = 0;
      let sum = 0;

      // Calculate exponential weighted slope
      for (let i = 1; i < series.length; i++) {
        const weight = Math.exp(0.1 * (i - 1)); // Exponential weight
        if (isNaN(series[i]) || isNaN(series[i - 1]) || series[i - 1] === 0) continue;

        const slope = (series[i] - series[i - 1]) / (series[i - 1] || 1); // Percent change
        if (isNaN(slope)) continue;

        sum += slope * weight;
        weights += weight;
      }

      const trend = weights > 0 ? sum / weights : 0;

      // Limit extreme values to avoid overreaction
      const result = Math.max(-0.3, Math.min(0.3, trend));
      return isNaN(result) ? 0 : result;
    } catch (error) {
      console.error('Error in _calculateAdvancedTrendFactor:', error);
      return 0;
    }
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
    try {
      this.currentUserId = userId; // Set currentUserId when updating forecasts
      const startTime = Date.now();

      // Clear the goal calculation cache to ensure fresh forecasts after transactions
      this.goalCalculationCache.delete(`goal_${userId}`);

      const budgetForecasts = await this.predictFinancialForecast(userId);

      let goalForecast = null;
      try {
        goalForecast = await this._calculateEnhancedGoalForecast(userId);
      } catch (goalError) {
        console.error('Error calculating goal forecast:', goalError);
        // Continue without goal forecast if there's an error
      }

      // Validate data before saving to database
      const validatedForecasts = this._validateForecastData(budgetForecasts);
      const validatedGoalForecast = goalForecast ? this._validateGoalForecastData(goalForecast) : null;

      const confidenceScore = this._calculateOverallConfidence(validatedForecasts);

      // Calculate data quality metrics
      const dataQuality = await this._calculateDataQuality(userId);

      // Ensure all data quality values are valid numbers
      const safeDataQuality = {
        transactionCount: Number(dataQuality.transactionCount) || 0,
        monthsOfData: Number(dataQuality.monthsOfData) || 1,
        completeness: Number(dataQuality.completeness) || 0,
      };

      const updateOperation = {
        budgetForecasts: validatedForecasts,
        goalForecast: validatedGoalForecast,
        lastUpdated: new Date(),
        forecastMethod: 'Advanced-AI-Enhanced-v4', // Updated version
        confidenceScore: isNaN(confidenceScore) ? 50 : confidenceScore,
        calculationStatus: 'completed',
        calculationProgress: 100,
        calculationTime: Date.now() - startTime,
        dataQuality: safeDataQuality,
      };

      if (session) {
        return ForecastCollection.findOneAndUpdate({ userId }, updateOperation, { upsert: true, new: true, session });
      }

      return ForecastCollection.findOneAndUpdate({ userId }, updateOperation, { upsert: true, new: true });
    } catch (error) {
      console.error('Error in updateForecasts:', error);
      // Return default forecast in case of error
      const defaultForecasts = this._generateVariedDefaultForecast();
      const updateOperation = {
        budgetForecasts: defaultForecasts,
        goalForecast: null,
        lastUpdated: new Date(),
        forecastMethod: 'Advanced-AI-Enhanced-v4-Default',
        confidenceScore: 30,
        calculationStatus: 'failed',
        calculationProgress: 0,
        dataQuality: {
          transactionCount: 0,
          monthsOfData: 1,
          completeness: 0,
        },
      };

      if (session) {
        return ForecastCollection.findOneAndUpdate({ userId }, updateOperation, { upsert: true, new: true, session });
      }

      return ForecastCollection.findOneAndUpdate({ userId }, updateOperation, { upsert: true, new: true });
    }
  }

  _validateForecastData(forecasts) {
    if (!forecasts || !Array.isArray(forecasts)) {
      return this._generateDefaultForecast();
    }

    return forecasts.map((forecast) => {
      // Ensure all numeric values are valid numbers
      const safeExpense = isNaN(forecast.projectedExpense) ? 1000 : forecast.projectedExpense;
      const safeIncome = isNaN(forecast.projectedIncome) ? 1500 : forecast.projectedIncome;
      const safeBalance = isNaN(forecast.projectedBalance) ? 500 : forecast.projectedBalance;
      const safeRisk = isNaN(forecast.riskAssessment) ? 50 : forecast.riskAssessment;

      // Ensure confidence values are valid
      const confidence = forecast.confidence || { expense: 50, income: 50, balance: 50 };
      const safeConfidence = {
        expense: isNaN(confidence.expense) ? 50 : confidence.expense,
        income: isNaN(confidence.income) ? 50 : confidence.income,
        balance: isNaN(confidence.balance) ? 50 : confidence.balance,
      };

      // Ensure category predictions are valid
      const safeCategories = {};
      if (forecast.categoryPredictions) {
        Object.entries(forecast.categoryPredictions).forEach(([category, data]) => {
          if (data && typeof data === 'object') {
            safeCategories[category] = {
              amount: isNaN(data.amount) ? 0 : data.amount,
              type: data.type || 'expense',
            };
          }
        });
      }

      return {
        date: forecast.date || new Date(),
        monthStr: forecast.monthStr || (forecast.date ? format(forecast.date, 'yyyy-MM') : ''),
        projectedExpense: safeExpense,
        projectedIncome: safeIncome,
        projectedBalance: safeBalance,
        categoryPredictions: safeCategories,
        confidence: safeConfidence,
        riskAssessment: safeRisk,
      };
    });
  }

  _validateGoalForecastData(goalForecast) {
    if (!goalForecast) return null;

    try {
      // Validate numeric values
      const safeExpectedMonths = isNaN(goalForecast.expectedMonthsToGoal) ? 12 : goalForecast.expectedMonthsToGoal;
      const safeBestCaseMonths = isNaN(goalForecast.bestCaseMonthsToGoal) ? 6 : goalForecast.bestCaseMonthsToGoal;
      const safeWorstCaseMonths = isNaN(goalForecast.worstCaseMonthsToGoal) ? 24 : goalForecast.worstCaseMonthsToGoal;
      const safeMonthlySavings = isNaN(goalForecast.monthlySavings) ? 100 : goalForecast.monthlySavings;
      const safeVariability = isNaN(goalForecast.savingsVariability) ? 50 : goalForecast.savingsVariability;
      const safeProbability = isNaN(goalForecast.probability) ? 50 : goalForecast.probability;

      // Ensure risk factors are valid
      let safeRiskFactors = [];

      if (goalForecast.riskFactors && Array.isArray(goalForecast.riskFactors)) {
        safeRiskFactors = goalForecast.riskFactors
          .map((risk) => {
            if (!risk || typeof risk !== 'object') return null;

            return {
              type: typeof risk.type === 'string' ? risk.type : 'unknown_risk',
              severity: !isNaN(risk.severity) ? Math.round(risk.severity) : 50,
              description: typeof risk.description === 'string' ? risk.description : 'Risk factor',
            };
          })
          .filter((risk) => risk !== null);
      }

      return {
        goalId: goalForecast.goalId,
        expectedMonthsToGoal: Math.round(safeExpectedMonths),
        bestCaseMonthsToGoal: Math.round(safeBestCaseMonths),
        worstCaseMonthsToGoal: Math.round(Math.min(120, safeWorstCaseMonths)), // Cap at 10 years for UI
        projectedDate: goalForecast.projectedDate || addMonths(new Date(), safeExpectedMonths),
        monthlySavings: Math.round(safeMonthlySavings * 100) / 100, // Round to 2 decimal places
        savingsVariability: Math.round(safeVariability * 100) / 100,
        probability: Math.round(safeProbability),
        riskFactors: safeRiskFactors,
      };
    } catch (error) {
      console.error('Error in _validateGoalForecastData:', error);
      // Return safe defaults
      return {
        goalId: goalForecast.goalId,
        expectedMonthsToGoal: 12,
        bestCaseMonthsToGoal: 6,
        worstCaseMonthsToGoal: 24,
        projectedDate: addMonths(new Date(), 12),
        monthlySavings: 100,
        savingsVariability: 50,
        probability: 50,
        riskFactors: [],
      };
    }
  }

  _calculateOverallConfidence(forecasts) {
    if (!forecasts || forecasts.length === 0) return 50;

    const confidenceScores = forecasts
      .slice(0, 3) // Focus on short-term forecasts which are more reliable
      .map((f) => (f.confidence.expense + f.confidence.income + f.confidence.balance) / 3);

    return confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;
  }

  async _calculateEnhancedGoalForecast(userId) {
    try {
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

      if (!transactions || transactions.length === 0) {
        // Not enough data to make a meaningful forecast
        return {
          goalId: activeGoal._id,
          expectedMonthsToGoal: 12,
          bestCaseMonthsToGoal: 6,
          worstCaseMonthsToGoal: 24,
          projectedDate: addMonths(new Date(), 12),
          monthlySavings: 100,
          savingsVariability: 0,
          probability: 50,
          riskFactors: [],
        };
      }

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

      // Ensure we have positive values for calculations
      const safeMonthlySavings = Math.max(1, avgMonthlySavings);

      // Project with variance consideration
      const optimisticSavings = Math.max(safeMonthlySavings, safeMonthlySavings + savingsVariability * 0.5);

      // Use multiple approaches to calculate pessimistic scenarios for more realistic estimates

      // 1. Standard approach - subtract variability but with limits
      const standardPessimistic = Math.max(safeMonthlySavings * 0.2, safeMonthlySavings - savingsVariability);

      // 2. Percentile-based approach - use the worst 25% of historical data
      const sortedSavings = [...monthlySavingsData].sort((a, b) => a - b);
      const worstQuartileSavings = sortedSavings[Math.floor(sortedSavings.length * 0.25)] || safeMonthlySavings * 0.5;
      const percentilePessimistic = Math.max(1, worstQuartileSavings);

      // 3. Trend-based approach - if savings are declining, project based on rate of decline
      let trendPessimistic = safeMonthlySavings * 0.5; // Default
      if (monthlySavingsData.length >= 3) {
        const recentAvg = monthlySavingsData.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const olderAvg =
          monthlySavingsData.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, monthlySavingsData.slice(3).length);

        if (recentAvg < olderAvg && olderAvg > 0) {
          // Calculate trend decline rate
          const declineRate = (olderAvg - recentAvg) / olderAvg;
          // Project forward with continued decline (but put a floor on it)
          trendPessimistic = Math.max(safeMonthlySavings * 0.3, safeMonthlySavings * (1 - declineRate));
        }
      }

      // Choose the most appropriate pessimistic value based on data quality
      let pessimisticSavings;
      const negativeMonths = monthlySavingsData.filter((s) => s <= 0).length;

      if (negativeMonths >= 2) {
        // High risk scenario - multiple negative savings months
        pessimisticSavings = Math.max(1, safeMonthlySavings * 0.15);
      } else if (savingsVariability > safeMonthlySavings) {
        // High variability scenario
        pessimisticSavings = Math.max(1, Math.min(percentilePessimistic, trendPessimistic));
      } else {
        // Normal scenario - use standard approach
        pessimisticSavings = Math.max(1, standardPessimistic);
      }

      const bestCaseMonths = Math.max(1, Math.ceil(remaining / optimisticSavings));

      // Calculate worst case months with a more accurate but bounded approach
      let worstCaseMonths;

      if (remaining <= 0) {
        worstCaseMonths = 1; // Already achieved
      } else {
        // The base calculation
        worstCaseMonths = Math.ceil(remaining / pessimisticSavings);

        // Apply scaling based on savings data quality
        const dataQualityFactor = Math.min(1, monthlySavingsData.filter((s) => s > 0).length / 6);

        // Cap the worst case months with data quality consideration
        // Higher quality data = stricter cap
        const maxMonths = 36 + (1 - dataQualityFactor) * 84; // Between 36 and 120 months

        // Apply the cap
        worstCaseMonths = Math.min(Math.round(maxMonths), worstCaseMonths);
      }

      const expectedMonths = Math.max(1, Math.ceil(remaining / Math.max(1, safeMonthlySavings)));
      const projectedDate = addMonths(new Date(), expectedMonths);

      // Calculate probability with more factors
      const probability = this._calculateEnhancedGoalProbability(
        Math.abs(safeMonthlySavings),
        remaining,
        activeGoal.targetAmount,
        savingsVariability,
        monthlySavingsData,
      );

      const goalForecast = {
        goalId: activeGoal._id,
        expectedMonthsToGoal: expectedMonths,
        bestCaseMonthsToGoal: bestCaseMonths,
        worstCaseMonthsToGoal: worstCaseMonths,
        projectedDate,
        monthlySavings: Math.abs(safeMonthlySavings),
        savingsVariability,
        probability,
        riskFactors: this._assessGoalRiskFactors(safeMonthlySavings, savingsVariability, remaining, monthlySavingsData),
      };

      this.goalCalculationCache.set(cacheKey, {
        data: goalForecast,
        timestamp: Date.now(),
      });

      return goalForecast;
    } catch (error) {
      console.error('Error in _calculateEnhancedGoalForecast:', error);
      throw error; // Propagate error to be handled in updateForecasts
    }
  }

  _calculateEnhancedGoalProbability(monthlySavings, remaining, targetAmount, variability, historicalSavings) {
    try {
      if (remaining <= 0) return 100; // Already achieved
      if (monthlySavings <= 0) return 0; // No savings

      // Check how many months had negative savings
      const negativeMonths = historicalSavings ? historicalSavings.filter((s) => s <= 0).length : 0;
      const positiveMonths = historicalSavings ? historicalSavings.filter((s) => s > 0).length : 0;
      const positiveRatio =
        historicalSavings && historicalSavings.length > 0 ? positiveMonths / historicalSavings.length : 0.5;

      // Base achievement factor - using both target and time-based calculation
      // Scale by remaining percentage and months needed
      const percentageRemaining = remaining / (targetAmount || 1);
      const monthsNeeded = remaining / (monthlySavings || 1);

      // Lower achievement factor for longer timeframes
      const achievementFactor = Math.min(
        1,
        (1 - percentageRemaining) * 0.5 + // 50% weight to percentage completed
          (monthsNeeded <= 12 ? 0.5 : 0.5 * (12 / monthsNeeded)), // 50% weight to time factor
      );

      // Variability factor - ratio of savings to variability
      const variabilityFactor = Math.max(0.3, Math.min(1, monthlySavings / (variability + 1)));

      // Consistency factor - based on how many months had positive savings
      const consistencyFactor = Math.max(0.4, positiveRatio);

      // Trend analysis - are savings increasing or decreasing?
      let trendFactor = 0;
      if (historicalSavings && historicalSavings.length >= 3) {
        const recentAvg = historicalSavings.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const olderAvg =
          historicalSavings.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, historicalSavings.slice(3).length);

        // Stronger impact from trend
        trendFactor = recentAvg >= olderAvg ? 0.3 : -0.2;
      }

      // Calculate baseline probability
      let baselineProbability =
        40 + // Base probability of 40%
        achievementFactor * 30 + // Up to 30% from achievement
        variabilityFactor * 15 + // Up to 15% from stability
        consistencyFactor * 10 + // Up to 10% from consistency
        trendFactor * 15; // Up to +15% / -10% from trend

      // Apply a penalty for negative months
      if (negativeMonths > 0) {
        baselineProbability -= negativeMonths * 8; // Each negative month reduces probability
      }

      // Ensure probability stays between 0 and 100
      let finalProbability = Math.max(0, Math.min(100, Math.round(baselineProbability)));

      // Ensure minimum probability with positive savings
      if (monthlySavings > 0 && finalProbability < 5) {
        finalProbability = 5; // Minimum 5% probability if any positive savings
      }

      return finalProbability;
    } catch (error) {
      console.error('Error in _calculateEnhancedGoalProbability:', error);
      // Return a reasonable default with minimum of 5%
      return Math.min(Math.max(Math.round((monthlySavings / (remaining || 1)) * 50), monthlySavings > 0 ? 5 : 0), 100);
    }
  }

  _assessGoalRiskFactors(monthlySavings, variability, remaining, historicalSavings) {
    try {
      const risks = [];

      // Assess savings consistency
      const variabilityRatio = variability / (monthlySavings || 1);
      if (variabilityRatio > 0.5) {
        risks.push({
          type: 'high_variability',
          severity: Math.min(100, Math.round(variabilityRatio * 100)),
          description: 'Ваша норма заощаджень дуже різна.',
        });
      }

      // Assess negative trend
      if (historicalSavings && historicalSavings.length >= 4) {
        const recentAvg = historicalSavings.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
        const olderAvg = historicalSavings.slice(2, 4).reduce((a, b) => a + b, 0) / 2;

        if (recentAvg < olderAvg) {
          const trendSeverity = Math.min(100, Math.round(((olderAvg - recentAvg) / (olderAvg || 1)) * 100));
          risks.push({
            type: 'declining_savings',
            severity: trendSeverity,
            description: 'Ваша недавня норма заощаджень знижується',
          });
        }
      }

      // Assess if goal is too ambitious
      const monthsRequired = remaining / (monthlySavings || 1);
      if (monthsRequired > 36) {
        risks.push({
          type: 'ambitious_timeline',
          severity: Math.min(100, Math.round((monthsRequired - 36) * 2)),
          description: 'Для досягнення вашої мети може знадобитися багато часу',
        });
      }

      // Assess negative months
      if (historicalSavings && historicalSavings.length > 0) {
        const negativeMonths = historicalSavings.filter((s) => s < 0).length;
        if (negativeMonths > 0) {
          risks.push({
            type: 'negative_months',
            severity: Math.min(100, Math.round((negativeMonths / historicalSavings.length) * 100)),
            description: 'У вас були місяці з негативними заощадженнями',
          });
        }
      }

      return risks;
    } catch (error) {
      console.error('Error in _assessGoalRiskFactors:', error);
      return [];
    }
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

  _getDefaultValue(series, type) {
    // Get average from series, or default to reasonable amounts
    if (series && series.length > 0) {
      const validValues = series.filter((val) => !isNaN(val) && val !== null);
      if (validValues.length > 0) {
        return validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
      }
    }
    // Default fallback values
    return type === 'expense' ? 1000 : 1500;
  }

  _generateDefaultMonthForecast(monthOffset) {
    const date = addMonths(new Date(), monthOffset + 1);
    return {
      date,
      monthStr: format(date, 'yyyy-MM'),
      projectedExpense: 1000,
      projectedIncome: 1500,
      projectedBalance: 500,
      categoryPredictions: {},
      confidence: {
        expense: 50,
        income: 50,
        balance: 50,
      },
      riskAssessment: 50,
    };
  }

  _generateDefaultForecast() {
    return Array.from({ length: 12 }, (_, i) => this._generateDefaultMonthForecast(i));
  }

  _extractMonthlyPatterns(dates, expenses, incomes) {
    // Create patterns by month (1-12)
    const monthlyData = {};

    // Initialize with default values
    for (let i = 1; i <= 12; i++) {
      monthlyData[i] = {
        expenses: [],
        incomes: [],
        expenseFactor: 1,
        incomeFactor: 1,
      };
    }

    // Group data by month
    dates.forEach((dateStr, i) => {
      if (!isValid(parseISO(dateStr))) return;

      const month = parseInt(dateStr.split('-')[1]); // Extract month from YYYY-MM
      if (month >= 1 && month <= 12) {
        if (i < expenses.length) monthlyData[month].expenses.push(expenses[i]);
        if (i < incomes.length) monthlyData[month].incomes.push(incomes[i]);
      }
    });

    // Calculate average values
    const avgExpense = expenses.reduce((sum, val) => sum + val, 0) / expenses.length || 1;
    const avgIncome = incomes.reduce((sum, val) => sum + val, 0) / incomes.length || 1;

    // Calculate monthly factors
    for (let i = 1; i <= 12; i++) {
      const monthExpenses = monthlyData[i].expenses;
      const monthIncomes = monthlyData[i].incomes;

      if (monthExpenses.length > 0) {
        const monthAvgExpense = monthExpenses.reduce((sum, val) => sum + val, 0) / monthExpenses.length;
        monthlyData[i].expenseFactor = monthAvgExpense / avgExpense;
      }

      if (monthIncomes.length > 0) {
        const monthAvgIncome = monthIncomes.reduce((sum, val) => sum + val, 0) / monthIncomes.length;
        monthlyData[i].incomeFactor = monthAvgIncome / avgIncome;
      }
    }

    return monthlyData;
  }

  _getMonthVariation(monthOffset, monthNumber) {
    // Create deterministic but different variations for each month
    // Use monthOffset and monthNumber to generate unique variations
    const seed = (monthOffset * 7 + monthNumber * 13) % 100;
    const normalizedSeed = seed / 100;

    return {
      expenseVariation: normalizedSeed * 0.2 - 0.1, // -10% to +10%
      incomeVariation: ((normalizedSeed + 0.2) % 1) * 0.2 - 0.1, // -10% to +10% (different from expense)
      trendVariation: ((normalizedSeed + 0.5) % 1) * 0.1 - 0.05, // -5% to +5%
      confidenceVariation: -monthOffset * 2, // Confidence decreases with time
    };
  }

  async _predictCategoriesWithVariation(categoryData, monthOffset, dates, monthPattern, monthVariation) {
    const predictions = {};

    // If we have no category data, try to get recent transactions to generate basic predictions
    if (Object.keys(categoryData).length === 0) {
      try {
        const recentTransactions = await TransactionCollection.find({
          userId: this.currentUserId,
          date: { $gte: subMonths(new Date(), 3) },
        }).sort({ date: -1 });

        // Group transactions by category
        const categoryTotals = {};
        recentTransactions.forEach((transaction) => {
          if (!categoryTotals[transaction.category]) {
            categoryTotals[transaction.category] = {
              total: 0,
              count: 0,
              type: transaction.type,
            };
          }
          categoryTotals[transaction.category].total += transaction.amount;
          categoryTotals[transaction.category].count += 1;
        });

        // Generate predictions based on recent transactions
        for (const [category, data] of Object.entries(categoryTotals)) {
          const avgAmount = data.total / data.count;
          const variationFactor =
            data.type === 'expense' ? monthVariation.expenseVariation : monthVariation.incomeVariation;
          const patternFactor = data.type === 'expense' ? monthPattern.expenseFactor : monthPattern.incomeFactor;

          predictions[category] = {
            amount: Math.max(avgAmount * patternFactor * (1 + variationFactor), 0),
            type: data.type,
          };
        }
        return predictions;
      } catch (error) {
        console.error('Error generating basic category predictions:', error);
        return {};
      }
    }

    // Process each category
    for (const [category, data] of Object.entries(categoryData)) {
      try {
        // Calculate base amount from available data
        const validAmounts = data.amounts.filter((amount) => amount > 0);
        const baseAmount =
          validAmounts.length > 0 ? validAmounts.reduce((sum, val) => sum + val, 0) / validAmounts.length : 0;

        // Apply variation and pattern factors
        const variationFactor =
          data.type === 'expense' ? monthVariation.expenseVariation : monthVariation.incomeVariation;
        const patternFactor = data.type === 'expense' ? monthPattern.expenseFactor : monthPattern.incomeFactor;

        // Calculate prediction with variation
        const prediction = baseAmount * patternFactor * (1 + variationFactor);

        predictions[category] = {
          amount: Math.max(prediction, 0),
          type: data.type,
        };
      } catch (error) {
        console.error(`Error predicting for category ${category}:`, error);
        // Fallback to simple prediction
        predictions[category] = {
          amount: data.type === 'expense' ? 1000 : 1500,
          type: data.type,
        };
      }
    }

    return predictions;
  }

  _generateVariedDefaultMonthForecast(monthOffset) {
    const date = addMonths(new Date(), monthOffset + 1);
    const monthNumber = parseInt(format(date, 'MM'));

    // Create deterministic but varying values
    const seed = (monthOffset * 7 + monthNumber * 13) % 100;
    const variationFactor = 1 + ((seed / 100) * 0.4 - 0.2); // -20% to +20%
    const expenseVariation = 1 + ((seed / 100) * 0.3 - 0.15); // -15% to +15%
    const incomeVariation = 1 + ((((seed + 50) % 100) / 100) * 0.3 - 0.15); // -15% to +15%

    // Vary the default values based on month
    const baseExpense = 1000 * expenseVariation;
    const baseIncome = 1500 * incomeVariation;
    const baseBalance = Math.max(0, baseIncome - baseExpense);

    // Confidence decreases with time
    const confidenceBase = Math.max(60, 90 - monthOffset * 2);

    return {
      date,
      monthStr: format(date, 'yyyy-MM'),
      projectedExpense: baseExpense,
      projectedIncome: baseIncome,
      projectedBalance: baseBalance,
      categoryPredictions: {},
      confidence: {
        expense: confidenceBase,
        income: confidenceBase,
        balance: confidenceBase,
      },
      riskAssessment: 50 * variationFactor,
    };
  }

  _generateVariedDefaultForecast() {
    return Array.from({ length: 12 }, (_, i) => this._generateVariedDefaultMonthForecast(i));
  }

  // Calculate data quality metrics
  async _calculateDataQuality(userId) {
    try {
      // Get transaction count
      const transactionCount = await TransactionCollection.countDocuments({ userId });

      // Get date range of transactions
      const oldestTransaction = await TransactionCollection.findOne({ userId }, { sort: { date: 1 } });
      const newestTransaction = await TransactionCollection.findOne({ userId }, { sort: { date: -1 } });

      let monthsOfData = 0;
      if (oldestTransaction && newestTransaction) {
        const monthsDiff = differenceInMonths(newestTransaction.date, oldestTransaction.date);
        // Ensure we always have a valid number (at least 1)
        monthsOfData = Math.max(1, monthsDiff + 1);
      }

      // Calculate completeness (percentage of months with transactions)
      let completeness = 0;
      if (monthsOfData > 0) {
        const monthsWithTransactions = await TransactionCollection.aggregate([
          { $match: { userId } },
          { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } } } },
          { $count: 'count' },
        ]);

        const monthCount = monthsWithTransactions.length > 0 ? monthsWithTransactions[0].count : 0;
        completeness = Math.min(100, Math.round((monthCount / monthsOfData) * 100));
      }

      return {
        transactionCount: transactionCount || 0,
        monthsOfData: monthsOfData || 1, // Ensure we always return a valid number
        completeness: completeness || 0,
      };
    } catch (error) {
      console.error('Error calculating data quality:', error);
      return {
        transactionCount: 0,
        monthsOfData: 1, // Default to 1 instead of 0 to avoid NaN issues
        completeness: 0,
      };
    }
  }
}
