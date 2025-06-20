import { ForecastCollection } from '../db/models/Forecast.js';
import { GoalCollection } from '../db/models/Goal.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import * as tf from '@tensorflow/tfjs';
import { addMonths, subMonths, format, differenceInMonths, parseISO, isValid } from 'date-fns';

export default class AdvancedAIForecastService {
  constructor() {
    this.forecastCache = new Map();
    AdvancedAIForecastService;
    this.goalCalculationCache = new Map();
    this.MODEL_CACHE_DURATION = 2 * 60 * 60 * 1000;
    this.trainedModels = new Map();
    this.PROGRESS_UPDATE_INTERVAL = 5;
    this.currentUserId = null;
  }

  async prepareForecastData(userId, numMonths = 36) {
    const startDate = subMonths(new Date(), numMonths);

    const transactions = await TransactionCollection.find({
      userId,
      date: { $gte: startDate },
    }).sort({ date: 1 });

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

      if (transaction.type === 'expense') {
        monthlyData[monthStr].expenses += transaction.amount;
      } else {
        monthlyData[monthStr].incomes += transaction.amount;
      }
      monthlyData[monthStr].transactionCount++;

      monthlyData[monthStr].categories.add(transaction.category);

      if (!monthlyData[monthStr].categoryBreakdown[transaction.category]) {
        monthlyData[monthStr].categoryBreakdown[transaction.category] = {
          amount: 0,
          type: transaction.type,
        };
      }
      monthlyData[monthStr].categoryBreakdown[transaction.category].amount += transaction.amount;
    });

    const dates = Object.keys(monthlyData).sort();
    const expenses = dates.map((date) => monthlyData[date].expenses);
    const incomes = dates.map((date) => monthlyData[date].incomes);
    const transactionCounts = dates.map((date) => monthlyData[date].transactionCount);
    const categories = [...new Set(dates.flatMap((date) => [...monthlyData[date].categories]))];

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
      console.log(`Using cached forecast for user ${userId}, created ${Date.now() - cachedForecast.timestamp}ms ago`);
      return cachedForecast.data;
    }

    console.log(`Generating new financial forecast for user ${userId}`);
    try {
      await this._updateProgress(userId, 20);

      const data = await this.prepareForecastData(userId);
      console.log(
        `Prepared forecast data: ${data.expenses.length} expense records, ${data.incomes.length} income records`,
      );

      if (!data.expenses.length || !data.incomes.length) {
        console.log(`Insufficient transaction data for user ${userId}, using default forecast`);
        return this._generateVariedDefaultForecast();
      }

      await this._updateProgress(userId, 30);

      const cleanedExpenses = this._removeOutliers(data.expenses);
      const cleanedIncomes = this._removeOutliers(data.incomes);

      await this._updateProgress(userId, 40);

      const expenseModel = await this._trainOrGetModel(userId, cleanedExpenses, 'expense', data.dates);
      console.log(`Expense model ${expenseModel ? 'successfully trained/loaded' : 'could not be trained'}`);

      await this._updateProgress(userId, 50);

      const incomeModel = await this._trainOrGetModel(userId, cleanedIncomes, 'income', data.dates);
      console.log(`Income model ${incomeModel ? 'successfully trained/loaded' : 'could not be trained'}`);

      await this._updateProgress(userId, 60);

      const avgExpense = cleanedExpenses.reduce((sum, val) => sum + val, 0) / cleanedExpenses.length;
      const avgIncome = cleanedIncomes.reduce((sum, val) => sum + val, 0) / cleanedIncomes.length;
      console.log(`Average expense: ${avgExpense}, Average income: ${avgIncome}`);

      const monthlyPatterns = this._extractMonthlyPatterns(data.dates, cleanedExpenses, cleanedIncomes);

      await this._updateProgress(userId, 70);

      const forecastMonths = 12;
      const experimentalForecast = await Promise.all(
        Array.from({ length: forecastMonths }, async (_, i) => {
          try {
            const date = addMonths(new Date(), i + 1);
            const monthStr = format(date, 'yyyy-MM');
            const monthNumber = parseInt(format(date, 'MM'));

            const monthPattern = monthlyPatterns[monthNumber] || { expenseFactor: 1, incomeFactor: 1 };

            const monthVariation = this._getMonthVariation(i, monthNumber);

            const categoryPredictions = await this._predictCategoriesWithVariation(
              data.categoryData,
              i,
              data.dates,
              monthPattern,
              monthVariation,
            );

            let predictedExpense = await this._tfPredict(userId, 'expense', i + 1);
            let predictedIncome = await this._tfPredict(userId, 'income', i + 1);

            if (predictedExpense && !isNaN(predictedExpense)) {
              predictedExpense = predictedExpense * monthPattern.expenseFactor * (1 + monthVariation.expenseVariation);
              console.log(`Month ${i + 1} (${monthStr}): TF prediction for expense: ${predictedExpense}`);
            }

            if (predictedIncome && !isNaN(predictedIncome)) {
              predictedIncome = predictedIncome * monthPattern.incomeFactor * (1 + monthVariation.incomeVariation);
              console.log(`Month ${i + 1} (${monthStr}): TF prediction for income: ${predictedIncome}`);
            }

            if (!predictedExpense || predictedExpense <= 0 || isNaN(predictedExpense)) {
              predictedExpense =
                this._arimaBasedPrediction(cleanedExpenses, i) *
                monthPattern.expenseFactor *
                (1 + monthVariation.expenseVariation);
              console.log(`Month ${i + 1}: Using ARIMA fallback for expense: ${predictedExpense}`);
            }

            if (!predictedIncome || predictedIncome <= 0 || isNaN(predictedIncome)) {
              predictedIncome =
                this._arimaBasedPrediction(cleanedIncomes, i) *
                monthPattern.incomeFactor *
                (1 + monthVariation.incomeVariation);
              console.log(`Month ${i + 1}: Using ARIMA fallback for income: ${predictedIncome}`);
            }

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

            const safeExpense = isNaN(adjustedExpense)
              ? avgExpense * (1 + monthVariation.expenseVariation)
              : adjustedExpense;

            const safeIncome = isNaN(adjustedIncome)
              ? avgIncome * (1 + monthVariation.incomeVariation)
              : adjustedIncome;

            const projectedBalance = Math.max(0, safeIncome - safeExpense);

            const baseConfidence = (expenseConfidence + incomeConfidence) / 2;
            const balanceConfidence = Math.max(60, Math.min(95, baseConfidence - i * 2));

            const cleanedCategoryPredictions = {};
            for (const [category, prediction] of Object.entries(categoryPredictions)) {
              cleanedCategoryPredictions[category] = {
                amount: isNaN(prediction.amount) ? 0 : prediction.amount,
                type: prediction.type,
              };
            }

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

            return this._generateVariedDefaultMonthForecast(i);
          }
        }),
      );

      await this._updateProgress(userId, 90);

      console.log(
        `Setting forecast cache for user ${userId} with ${experimentalForecast.length} months of predictions`,
      );
      this.forecastCache.set(cacheKey, {
        data: experimentalForecast,
        timestamp: Date.now(),
      });

      await this._updateProgress(userId, 100);

      return experimentalForecast;
    } catch (error) {
      console.error('Error in predictFinancialForecast:', error);

      return this._generateVariedDefaultForecast();
    }
  }

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

  _adjustPredictionBasedOnConfidence(prediction, average, confidence) {
    if (confidence < 70) {
      const blendFactor = confidence / 100;
      return prediction * blendFactor + average * (1 - blendFactor);
    }
    return prediction;
  }

  async _trainOrGetModel(userId, series, type, dates, windowSize = 3, epochs = 100) {
    const modelKey = `model_${userId}_${type}_lstm_w${windowSize}`;

    if (
      this.trainedModels.has(modelKey) &&
      Date.now() - this.trainedModels.get(modelKey).timestamp < this.MODEL_CACHE_DURATION
    ) {
      console.log(`Using cached ${type} LSTM model for user ${userId}`);
      return this.trainedModels.get(modelKey).model;
    }

    if (series.length < windowSize + 5) {
      console.warn(
        `Not enough data for ${type} LSTM model (requires ${windowSize + 5}, got ${series.length}). Falling back.`,
      );
      return null;
    }

    try {
      console.log(`Training new ${type} LSTM model for user ${userId} with ${series.length} data points`);

      const { normalizedData, min, max } = this._normalizeData(series);

      const sequences = [];
      const labels = [];
      for (let i = 0; i < normalizedData.length - windowSize; i++) {
        sequences.push(normalizedData.slice(i, i + windowSize));
        labels.push(normalizedData[i + windowSize]);
      }

      if (sequences.length === 0) {
        console.warn(`Not enough sequences created for ${type} LSTM model. Falling back.`);
        return null;
      }

      const xs = tf.tensor3d(sequences, [sequences.length, windowSize, 1]);
      const ys = tf.tensor2d(labels, [labels.length, 1]);

      const model = tf.sequential();
      model.add(tf.layers.lstm({ units: 50, inputShape: [windowSize, 1], returnSequences: true }));
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.lstm({ units: 50, returnSequences: false }));
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.dense({ units: 1 }));

      model.compile({
        optimizer: tf.train.adam(0.005),
        loss: 'meanSquaredError',
      });

      await model.fit(xs, ys, {
        epochs: epochs,
        batchSize: Math.min(32, sequences.length),
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (epoch % 20 === 0 || epoch === epochs - 1) {
              console.log(`Training LSTM model for ${type}, epoch ${epoch + 1}/${epochs}: loss = ${logs.loss}`);
            }
          },
          onTrainEnd: () => {
            console.log(`Finished training ${type} LSTM model for user ${userId}`);
          },
        },
        shuffle: true,
      });

      tf.dispose([xs, ys]);

      this.trainedModels.set(modelKey, {
        model,
        timestamp: Date.now(),
        metadata: { min, max, windowSize, lastWindow: normalizedData.slice(-windowSize) },
      });

      return model;
    } catch (error) {
      console.error(`Error training LSTM model for ${type}:`, error);
      return null;
    }
  }

  async _tfPredict(userId, type, monthsAhead) {
    const modelKeyPrefix = `model_${userId}_${type}_lstm`;
    let bestModelKey = null;
    let latestTimestamp = 0;

    for (const key of this.trainedModels.keys()) {
      if (key.startsWith(modelKeyPrefix)) {
        const modelData = this.trainedModels.get(key);
        if (modelData.timestamp > latestTimestamp) {
          latestTimestamp = modelData.timestamp;
          bestModelKey = key;
        }
      }
    }

    if (!bestModelKey || !this.trainedModels.has(bestModelKey)) {
      return null;
    }

    const { model, metadata } = this.trainedModels.get(bestModelKey);
    const { min, max, windowSize, lastWindow: initialLastWindow } = metadata;

    if (!initialLastWindow || initialLastWindow.length !== windowSize) {
      console.error(`Invalid lastWindow in metadata for ${type}`);
      return null;
    }

    try {
      let currentWindow = [...initialLastWindow];
      let predictedValue;

      for (let i = 0; i < monthsAhead; i++) {
        const inputTensor = tf.tensor3d([currentWindow], [1, windowSize, 1]);
        const predictionNormalizedTensor = model.predict(inputTensor);
        const predictionNormalizedArray = await predictionNormalizedTensor.data();
        predictedValue = predictionNormalizedArray[0];

        tf.dispose(inputTensor);
        tf.dispose(predictionNormalizedTensor);

        currentWindow.shift();
        currentWindow.push(predictedValue);
      }

      return predictedValue * (max - min) + min;
    } catch (error) {
      console.error(`Error predicting with TF LSTM model for ${type}:`, error);
      return null;
    }
  }
  _normalizeData(data) {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    return {
      normalizedData: data.map((x) => (x - min) / range),
      min,
      max,
    };
  }

  _removeOutliers(series) {
    if (series.length < 4) return series;

    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const stdDev = Math.sqrt(series.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / series.length);

    const threshold = 2.5 * stdDev;

    return series.map((value) => {
      if (Math.abs(value - mean) > threshold) {
        return mean + Math.sign(value - mean) * threshold;
      }
      return value;
    });
  }

  async _predictCategories(categoryData, monthOffset, dates) {
    const predictions = {};

    for (const [category, data] of Object.entries(categoryData)) {
      const prediction = this._arimaBasedPrediction(data.amounts, monthOffset);
      const seasonalFactor = this._calculateAdvancedSeasonalityFactor(data.amounts, monthOffset, dates);
      const trendFactor = this._calculateAdvancedTrendFactor(data.amounts);

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
      const arOrder = Math.min(6, Math.floor(validSeries.length / 3));
      let arComponent = 0;
      let weightSum = 0;

      for (let i = 1; i <= arOrder; i++) {
        const index = validSeries.length - i;
        const weight = (arOrder - i + 1) / arOrder;

        if (index >= 0) {
          arComponent += validSeries[index] * weight;
          weightSum += weight;
        }
      }

      arComponent = weightSum > 0 ? arComponent / weightSum : validSeries[validSeries.length - 1];

      const errors = [];
      const maOrder = Math.min(3, Math.floor(validSeries.length / 4));

      for (let i = maOrder; i < validSeries.length; i++) {
        const predicted = validSeries.slice(i - maOrder, i).reduce((a, b) => a + b, 0) / maOrder;
        errors.push(validSeries[i] - predicted);
      }

      const maComponent = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;

      let differenced = [];
      for (let i = 1; i < validSeries.length; i++) {
        differenced.push(validSeries[i] - validSeries[i - 1]);
      }

      const meanDiff = differenced.length > 0 ? differenced.reduce((a, b) => a + b, 0) / differenced.length : 0;

      const prediction = arComponent + maComponent + meanDiff * monthOffset;

      const confidenceFactor = Math.min(1, validSeries.length / 12);
      const mean = validSeries.reduce((a, b) => a + b, 0) / validSeries.length;

      const result = prediction * confidenceFactor + mean * (1 - confidenceFactor);

      return isNaN(result) ? mean : result;
    } catch (error) {
      console.error('Error in _arimaBasedPrediction:', error);

      return validSeries.reduce((a, b) => a + b, 0) / validSeries.length;
    }
  }

  _adjustWithConfidence(prediction, seasonalityFactor, trendFactor, type = 'expense') {
    const adjustedValue = prediction * (1 + seasonalityFactor + trendFactor);

    const factorMagnitude = Math.abs(seasonalityFactor) + Math.abs(trendFactor);

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
      const targetMonth = format(addMonths(new Date(), monthOffset + 1), 'MM');
      const monthlyPatterns = {};

      dates.forEach((dateStr, i) => {
        if (!isValid(parseISO(dateStr))) return;

        const month = dateStr.split('-')[1];
        if (!monthlyPatterns[month]) {
          monthlyPatterns[month] = [];
        }

        if (i < series.length) {
          monthlyPatterns[month].push(series[i]);
        }
      });

      if (monthlyPatterns[targetMonth] && monthlyPatterns[targetMonth].length > 0) {
        const monthAverage =
          monthlyPatterns[targetMonth].reduce((a, b) => a + b, 0) / monthlyPatterns[targetMonth].length;

        const overallAverage = series.reduce((a, b) => a + b, 0) / series.length;

        if (overallAverage > 0) {
          const result = monthAverage / overallAverage - 1;
          return isNaN(result) ? 0 : result;
        }
      }

      const seasonalPattern = series.slice(-12);
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
      let weights = 0;
      let sum = 0;

      for (let i = 1; i < series.length; i++) {
        const weight = Math.exp(0.1 * (i - 1));
        if (isNaN(series[i]) || isNaN(series[i - 1]) || series[i - 1] === 0) continue;

        const slope = (series[i] - series[i - 1]) / (series[i - 1] || 1);
        if (isNaN(slope)) continue;

        sum += slope * weight;
        weights += weight;
      }

      const trend = weights > 0 ? sum / weights : 0;

      const result = Math.max(-0.3, Math.min(0.3, trend));
      return isNaN(result) ? 0 : result;
    } catch (error) {
      console.error('Error in _calculateAdvancedTrendFactor:', error);
      return 0;
    }
  }

  _calculateEnhancedRiskScore(expense, income, expenseConfidence, incomeConfidence) {
    const balanceRatio = income / (expense || 1);

    const baseRisk = Math.min(Math.max((1 - balanceRatio) * 100, 0), 100);

    const confidenceAdjustment = (100 - (expenseConfidence + incomeConfidence) / 2) * 0.3;

    const volatilityRisk = (100 - expenseConfidence) * 0.4;

    return Math.min(100, baseRisk * 0.6 + confidenceAdjustment + volatilityRisk * 0.3);
  }

  async updateForecasts(userId, session = null) {
    try {
      this.currentUserId = userId;
      const startTime = Date.now();
      console.log(`Starting forecast update for user ${userId} after transaction`);

      this.goalCalculationCache.delete(`goal_${userId}`);
      this.forecastCache.delete(`forecast_${userId}`);

      console.log(`Generating new budget forecasts for user ${userId}`);
      const budgetForecasts = await this.predictFinancialForecast(userId);

      let goalForecast = null;
      try {
        console.log(`Calculating enhanced goal forecast for user ${userId}`);
        goalForecast = await this._calculateEnhancedGoalForecast(userId);
        console.log(`Goal forecast calculated successfully for user ${userId}`);
      } catch (goalError) {
        console.error('Error calculating goal forecast:', goalError);
      }

      const validatedForecasts = this._validateForecastData(budgetForecasts);
      const validatedGoalForecast = goalForecast ? this._validateGoalForecastData(goalForecast) : null;

      const confidenceScore = this._calculateOverallConfidence(validatedForecasts);

      const dataQuality = await this._calculateDataQuality(userId);

      const safeDataQuality = {
        transactionCount: Number(dataQuality.transactionCount) || 0,
        monthsOfData: Number(dataQuality.monthsOfData) || 1,
        completeness: Number(dataQuality.completeness) || 0,
      };

      const updateOperation = {
        budgetForecasts: validatedForecasts,
        goalForecast: validatedGoalForecast,
        lastUpdated: new Date(),
        forecastMethod: 'Advanced-AI-Enhanced-v4.1',
        confidenceScore: isNaN(confidenceScore) ? 50 : confidenceScore,
        calculationStatus: 'completed',
        calculationProgress: 100,
        calculationTime: Date.now() - startTime,
        dataQuality: safeDataQuality,
      };

      console.log(`Forecast update completed for user ${userId} in ${Date.now() - startTime}ms`);
      console.log(`Forecast confidence: ${confidenceScore}, Data quality: ${JSON.stringify(safeDataQuality)}`);

      if (session) {
        return ForecastCollection.findOneAndUpdate({ userId }, updateOperation, { upsert: true, new: true, session });
      }

      return ForecastCollection.findOneAndUpdate({ userId }, updateOperation, { upsert: true, new: true });
    } catch (error) {
      console.error('Error in updateForecasts:', error);

      const defaultForecasts = this._generateVariedDefaultForecast();
      const updateOperation = {
        budgetForecasts: defaultForecasts,
        goalForecast: null,
        lastUpdated: new Date(),
        forecastMethod: 'Advanced-AI-Enhanced-v4.1-Default',
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
      const safeExpense = isNaN(forecast.projectedExpense) ? 1000 : forecast.projectedExpense;
      const safeIncome = isNaN(forecast.projectedIncome) ? 1500 : forecast.projectedIncome;
      const safeBalance = isNaN(forecast.projectedBalance) ? 500 : forecast.projectedBalance;
      const safeRisk = isNaN(forecast.riskAssessment) ? 50 : forecast.riskAssessment;

      const confidence = forecast.confidence || { expense: 50, income: 50, balance: 50 };
      const safeConfidence = {
        expense: isNaN(confidence.expense) ? 50 : confidence.expense,
        income: isNaN(confidence.income) ? 50 : confidence.income,
        balance: isNaN(confidence.balance) ? 50 : confidence.balance,
      };

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
      const safeExpectedMonths = isNaN(goalForecast.expectedMonthsToGoal) ? 12 : goalForecast.expectedMonthsToGoal;
      const safeBestCaseMonths = isNaN(goalForecast.bestCaseMonthsToGoal) ? 6 : goalForecast.bestCaseMonthsToGoal;
      const safeWorstCaseMonths = isNaN(goalForecast.worstCaseMonthsToGoal) ? 24 : goalForecast.worstCaseMonthsToGoal;
      const safeMonthlySavings = isNaN(goalForecast.monthlySavings) ? 100 : goalForecast.monthlySavings;
      const safeVariability = isNaN(goalForecast.savingsVariability) ? 50 : goalForecast.savingsVariability;
      const safeProbability = isNaN(goalForecast.probability) ? 50 : goalForecast.probability;

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
        worstCaseMonthsToGoal: Math.round(Math.min(120, safeWorstCaseMonths)),
        projectedDate: goalForecast.projectedDate || addMonths(new Date(), safeExpectedMonths),
        monthlySavings: Math.round(safeMonthlySavings * 100) / 100,
        savingsVariability: Math.round(safeVariability * 100) / 100,
        probability: Math.round(safeProbability),
        riskFactors: safeRiskFactors,
      };
    } catch (error) {
      console.error('Error in _validateGoalForecastData:', error);

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
      .slice(0, 3)
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

      const transactions = await TransactionCollection.find({
        userId,
        date: { $gte: addMonths(new Date(), -6) },
      });

      if (!transactions || transactions.length === 0) {
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

      let weightedSavings = 0;
      let weightSum = 0;

      for (let i = 0; i < monthlySavingsData.length; i++) {
        const weight = Math.exp(-0.4 * i);
        weightedSavings += monthlySavingsData[i] * weight;
        weightSum += weight;
      }

      const avgMonthlySavings = weightSum > 0 ? weightedSavings / weightSum : 0;

      const savingsVariability = this._calculateVariability(monthlySavingsData);

      const remaining = activeGoal.targetAmount - activeGoal.currentAmount;

      const safeMonthlySavings = Math.max(1, avgMonthlySavings);

      const optimisticSavings = Math.max(safeMonthlySavings, safeMonthlySavings + savingsVariability * 0.5);

      const standardPessimistic = Math.max(safeMonthlySavings * 0.2, safeMonthlySavings - savingsVariability);

      const sortedSavings = [...monthlySavingsData].sort((a, b) => a - b);
      const worstQuartileSavings = sortedSavings[Math.floor(sortedSavings.length * 0.25)] || safeMonthlySavings * 0.5;
      const percentilePessimistic = Math.max(1, worstQuartileSavings);

      let trendPessimistic = safeMonthlySavings * 0.5;
      if (monthlySavingsData.length >= 3) {
        const recentAvg = monthlySavingsData.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const olderAvg =
          monthlySavingsData.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, monthlySavingsData.slice(3).length);

        if (recentAvg < olderAvg && olderAvg > 0) {
          const declineRate = (olderAvg - recentAvg) / olderAvg;

          trendPessimistic = Math.max(safeMonthlySavings * 0.3, safeMonthlySavings * (1 - declineRate));
        }
      }

      let pessimisticSavings;
      const negativeMonths = monthlySavingsData.filter((s) => s <= 0).length;

      if (negativeMonths >= 2) {
        pessimisticSavings = Math.max(1, safeMonthlySavings * 0.15);
      } else if (savingsVariability > safeMonthlySavings) {
        pessimisticSavings = Math.max(1, Math.min(percentilePessimistic, trendPessimistic));
      } else {
        pessimisticSavings = Math.max(1, standardPessimistic);
      }

      const bestCaseMonths = Math.max(1, Math.ceil(remaining / optimisticSavings));

      let worstCaseMonths;

      if (remaining <= 0) {
        worstCaseMonths = 1;
      } else {
        worstCaseMonths = Math.ceil(remaining / pessimisticSavings);

        const dataQualityFactor = Math.min(1, monthlySavingsData.filter((s) => s > 0).length / 6);

        const maxMonths = 36 + (1 - dataQualityFactor) * 84;

        worstCaseMonths = Math.min(Math.round(maxMonths), worstCaseMonths);
      }

      const expectedMonths = Math.max(1, Math.ceil(remaining / Math.max(1, safeMonthlySavings)));
      const projectedDate = addMonths(new Date(), expectedMonths);

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
      throw error;
    }
  }

  _calculateEnhancedGoalProbability(monthlySavings, remaining, targetAmount, variability, historicalSavings) {
    try {
      if (remaining <= 0) return 100;
      if (monthlySavings <= 0) return 0;

      const negativeMonths = historicalSavings ? historicalSavings.filter((s) => s <= 0).length : 0;
      const positiveMonths = historicalSavings ? historicalSavings.filter((s) => s > 0).length : 0;
      const positiveRatio =
        historicalSavings && historicalSavings.length > 0 ? positiveMonths / historicalSavings.length : 0.5;

      const percentageRemaining = remaining / (targetAmount || 1);
      const monthsNeeded = remaining / (monthlySavings || 1);

      const achievementFactor = Math.min(
        1,
        (1 - percentageRemaining) * 0.5 + (monthsNeeded <= 12 ? 0.5 : 0.5 * (12 / monthsNeeded)),
      );

      const variabilityFactor = Math.max(0.3, Math.min(1, monthlySavings / (variability + 1)));

      const consistencyFactor = Math.max(0.4, positiveRatio);

      let trendFactor = 0;
      if (historicalSavings && historicalSavings.length >= 3) {
        const recentAvg = historicalSavings.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const olderAvg =
          historicalSavings.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, historicalSavings.slice(3).length);

        trendFactor = recentAvg >= olderAvg ? 0.3 : -0.2;
      }

      let baselineProbability =
        40 + achievementFactor * 30 + variabilityFactor * 15 + consistencyFactor * 10 + trendFactor * 15;

      if (negativeMonths > 0) {
        baselineProbability -= negativeMonths * 8;
      }

      let finalProbability = Math.max(0, Math.min(100, Math.round(baselineProbability)));

      if (monthlySavings > 0 && finalProbability < 5) {
        finalProbability = 5;
      }

      return finalProbability;
    } catch (error) {
      console.error('Error in _calculateEnhancedGoalProbability:', error);

      return Math.min(Math.max(Math.round((monthlySavings / (remaining || 1)) * 50), monthlySavings > 0 ? 5 : 0), 100);
    }
  }

  _assessGoalRiskFactors(monthlySavings, variability, remaining, historicalSavings) {
    try {
      const risks = [];

      const variabilityRatio = variability / (monthlySavings || 1);
      if (variabilityRatio > 0.5) {
        risks.push({
          type: 'high_variability',
          severity: Math.min(100, Math.round(variabilityRatio * 100)),
          description: 'Ваша норма заощаджень дуже різна.',
        });
      }

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

      const monthsRequired = remaining / (monthlySavings || 1);
      if (monthsRequired > 36) {
        risks.push({
          type: 'ambitious_timeline',
          severity: Math.min(100, Math.round((monthsRequired - 36) * 2)),
          description: 'Для досягнення вашої мети може знадобитися багато часу',
        });
      }

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
    if (series && series.length > 0) {
      const validValues = series.filter((val) => !isNaN(val) && val !== null);
      if (validValues.length > 0) {
        return validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
      }
    }

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
    const monthlyData = {};

    for (let i = 1; i <= 12; i++) {
      monthlyData[i] = {
        expenses: [],
        incomes: [],
        expenseFactor: 1,
        incomeFactor: 1,
      };
    }

    dates.forEach((dateStr, i) => {
      if (!isValid(parseISO(dateStr))) return;

      const month = parseInt(dateStr.split('-')[1]);
      if (month >= 1 && month <= 12) {
        if (i < expenses.length) monthlyData[month].expenses.push(expenses[i]);
        if (i < incomes.length) monthlyData[month].incomes.push(incomes[i]);
      }
    });

    const avgExpense = expenses.reduce((sum, val) => sum + val, 0) / expenses.length || 1;
    const avgIncome = incomes.reduce((sum, val) => sum + val, 0) / incomes.length || 1;

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
    const seed = (monthOffset * 7 + monthNumber * 13) % 100;
    const normalizedSeed = seed / 100;

    return {
      expenseVariation: normalizedSeed * 0.2 - 0.1,
      incomeVariation: ((normalizedSeed + 0.2) % 1) * 0.2 - 0.1,
      trendVariation: ((normalizedSeed + 0.5) % 1) * 0.1 - 0.05,
      confidenceVariation: -monthOffset * 2,
    };
  }

  async _predictCategoriesWithVariation(categoryData, monthOffset, dates, monthPattern, monthVariation) {
    const predictions = {};

    if (Object.keys(categoryData).length === 0) {
      try {
        const recentTransactions = await TransactionCollection.find({
          userId: this.currentUserId,
          date: { $gte: subMonths(new Date(), 3) },
        }).sort({ date: -1 });

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

    for (const [category, data] of Object.entries(categoryData)) {
      try {
        const validAmounts = data.amounts.filter((amount) => amount > 0);
        const baseAmount =
          validAmounts.length > 0 ? validAmounts.reduce((sum, val) => sum + val, 0) / validAmounts.length : 0;

        const variationFactor =
          data.type === 'expense' ? monthVariation.expenseVariation : monthVariation.incomeVariation;
        const patternFactor = data.type === 'expense' ? monthPattern.expenseFactor : monthPattern.incomeFactor;

        const prediction = baseAmount * patternFactor * (1 + variationFactor);

        predictions[category] = {
          amount: Math.max(prediction, 0),
          type: data.type,
        };
      } catch (error) {
        console.error(`Error predicting for category ${category}:`, error);

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

    const seed = (monthOffset * 7 + monthNumber * 13) % 100;
    const variationFactor = 1 + ((seed / 100) * 0.4 - 0.2);
    const expenseVariation = 1 + ((seed / 100) * 0.3 - 0.15);
    const incomeVariation = 1 + ((((seed + 50) % 100) / 100) * 0.3 - 0.15);

    const baseExpense = 1000 * expenseVariation;
    const baseIncome = 1500 * incomeVariation;
    const baseBalance = Math.max(0, baseIncome - baseExpense);

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

  async _calculateDataQuality(userId) {
    try {
      const transactionCount = await TransactionCollection.countDocuments({ userId });

      const oldestTransaction = await TransactionCollection.findOne({ userId }, { sort: { date: 1 } });
      const newestTransaction = await TransactionCollection.findOne({ userId }, { sort: { date: -1 } });

      let monthsOfData = 0;
      if (oldestTransaction && newestTransaction) {
        const monthsDiff = differenceInMonths(newestTransaction.date, oldestTransaction.date);

        monthsOfData = Math.max(1, monthsDiff + 1);
      }

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
        monthsOfData: monthsOfData || 1,
        completeness: completeness || 0,
      };
    } catch (error) {
      console.error('Error calculating data quality:', error);
      return {
        transactionCount: 0,
        monthsOfData: 1,
        completeness: 0,
      };
    }
  }

  _calculateConfidence(prediction, average, dataPoints, monthOffset, type) {
    const dataQualityFactor = Math.min(1, Math.max(0.5, dataPoints / 12));
    const timeDecayFactor = Math.max(0.5, 1 - monthOffset * 0.03);

    const predictionRatio = prediction / (average || 1);
    const plausibilityFactor = predictionRatio > 0.3 && predictionRatio < 3 ? 1 : 0.7;

    const baseConfidence = 80 * dataQualityFactor * timeDecayFactor * plausibilityFactor;

    const typeAdjustment = type === 'income' ? 5 : 0;

    return Math.min(95, Math.max(60, baseConfidence + typeAdjustment));
  }
}
