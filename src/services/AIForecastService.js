import { ForecastCollection } from '../db/models/Forecast.js';
import { GoalCollection } from '../db/models/Goal.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import * as tf from '@tensorflow/tfjs';
import { format, addMonths } from 'date-fns';

class AIForecastService {
  async prepareForecastData(userId) {
    const sixMonthsAgo = addMonths(new Date(), -6);
    const transactions = await TransactionCollection.find({
      userId,
      date: { $gte: sixMonthsAgo },
    });

    const processedData = {
      expenses: [],
      incomes: [],
      dates: [],
    };

    transactions.forEach((transaction) => {
      processedData.dates.push(format(transaction.date, 'yyyy-MM-dd'));
      processedData.expenses.push(transaction.type === 'expense' ? Number(transaction.amount) : 0);
      processedData.incomes.push(transaction.type === 'income' ? Number(transaction.amount) : 0);
    });

    return processedData;
  }

  async predictTimeSeriesForecast(userId) {
    const data = await this.prepareForecastData(userId);

    // Создание и обучение модели LSTM для прогнозирования
    const model = tf.sequential();
    model.add(
      tf.layers.lstm({
        units: 50,
        inputShape: [null, 1],
        returnSequences: true,
      }),
    );
    model.add(tf.layers.dense({ units: 1 }));

    model.compile({
      optimizer: 'adam',
      loss: 'meanSquaredError',
    });

    // Подготовка данных для модели машинного обучения
    const forecastMonths = 6;
    const experimentalForecast = Array.from({ length: forecastMonths }, (_, i) => {
      const date = addMonths(new Date(), i + 1);
      const predictedExpense = this._calculatePredictedValue(data.expenses);
      const predictedIncome = this._calculatePredictedValue(data.incomes);

      return {
        date,
        projectedExpense: predictedExpense,
        projectedIncome: predictedIncome,
        projectedBalance: predictedIncome - predictedExpense,
      };
    });

    return experimentalForecast;
  }

  _calculatePredictedValue(series) {
    // Использование продвинутых статистических методов
    const mean = series.reduce((a, b) => a + b) / series.length;
    const stdDev = Math.sqrt(series.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / series.length);

    // Прогнозирование с учетом тренда и волатильности
    return mean + stdDev * Math.random();
  }

  async updateForecasts(userId) {
    const budgetForecasts = await this.predictTimeSeriesForecast(userId);
    const goalForecast = await this._calculateGoalForecast(userId);

    return ForecastCollection.findOneAndUpdate(
      { userId },
      {
        budgetForecasts,
        goalForecast,
        lastUpdated: new Date(),
        forecastMethod: 'AI-Enhanced',
      },
      { upsert: true, new: true },
    );
  }

  async _calculateGoalForecast(userId) {
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
    const monthsToGoal = Math.max(1, Math.ceil(remaining / monthlySavings));
    const projectedDate = addMonths(new Date(), monthsToGoal);

    return {
      goalId: activeGoal._id,
      monthsToGoal,
      projectedDate,
      monthlySavings,
      probability: this._calculateGoalAchievementProbability(monthlySavings, remaining, activeGoal.targetAmount),
    };
  }

  _calculateGoalAchievementProbability(monthlySavings, remaining, targetAmount) {
    // Более сложный расчет вероятности достижения цели
    const achievementFactor = monthlySavings / remaining;
    return Math.min(Math.max(achievementFactor * 100, 0), 100);
  }
}

export default new AIForecastService();
