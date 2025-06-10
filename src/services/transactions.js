// services/transactions.js
import mongoose from 'mongoose';
import UserCollection from '../db/models/User.js';
import createHttpError from 'http-errors';
import { TransactionCollection } from '../db/models/Transaction.js';
import { updateGoalProgress } from './goal.js';

import AdvancedAIForecastService from './AIForecastService.js';
import { updateForecasts as updateForecastsService } from './forecast.js';

const forecastService = new AdvancedAIForecastService();

const DEFAULT_EXPENSE_WINDOW_SIZE = 3;
const DEFAULT_INCOME_WINDOW_SIZE = 3;

export const addTransaction = async (transactionData) => {
  try {
    console.log('Starting transaction process with data:', JSON.stringify(transactionData));

    const user = await UserCollection.findById(transactionData.userId);
    if (!user) {
      console.error('User not found:', transactionData.userId);
      throw new createHttpError(404, 'User not found');
    }

    console.log('User found:', {
      userId: user._id,
      balance: user.balance,
      lastBalanceUpdate: user.lastBalanceUpdate,
    });

    const amount = Number(transactionData.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new createHttpError(400, 'Invalid amount');
    }

    if (transactionData.type === 'expense' && user.balance < amount) {
      throw new createHttpError(400, 'Not enough balance');
    }

    return await processSequentially(transactionData);
  } catch (error) {
    console.error('Transaction service error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      data: transactionData,
      errorDetails: error.details || error.cause || error,
    });

    if (error instanceof createHttpError.HttpError) {
      throw error;
    }

    throw new createHttpError(500, 'Failed to process transaction', {
      cause: error,
      details: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
    });
  }
};

const processSequentially = async (transactionData) => {
  try {
    console.log('Processing transaction sequentially');

    const amount = Number(transactionData.amount);
    const userId = transactionData.userId;
    const transactionType = transactionData.type; // 'income' or 'expense'

    console.log('Creating transaction document');
    const transaction = await TransactionCollection.create(transactionData);
    console.log('Transaction created:', transaction._id);

    const balanceChange = transactionData.type === 'income' ? amount : -amount;
    console.log('Updating user balance:', { balanceChange });

    const updatedUser = await UserCollection.findByIdAndUpdate(
      userId,
      {
        $inc: { balance: balanceChange },
        lastBalanceUpdate: new Date(),
      },
      { new: true },
    );

    console.log('User balance updated:', {
      newBalance: updatedUser.balance,
      lastUpdate: updatedUser.lastBalanceUpdate,
    });

    console.log('Updating goal progress');
    let goalUpdate = null;
    try {
      goalUpdate = await updateGoalProgress(userId, balanceChange);
      console.log('Goal progress updated successfully');
    } catch (goalError) {
      console.error('Error updating goal progress (continuing):', goalError.message);
    }

    try {
      console.log(`Invalidating caches for user ${userId} before forecast update...`);

      const expenseModelKey = `model_${userId}_expense_lstm_w${DEFAULT_EXPENSE_WINDOW_SIZE}`;
      const incomeModelKey = `model_${userId}_income_lstm_w${DEFAULT_INCOME_WINDOW_SIZE}`;

      for (const key of [...forecastService.trainedModels.keys()]) {
        if (key.startsWith(`model_${userId}`)) {
          console.log(`Invalidating model cache: ${key}`);
          forecastService.trainedModels.delete(key);
        }
      }

      forecastService.forecastCache.delete(`forecast_${userId}`);

      forecastService.goalCalculationCache.delete(`goal_${userId}`);

      console.log(`Caches invalidated for user ${userId}.`);
    } catch (cacheError) {
      console.error(`Error invalidating caches for user ${userId} (continuing):`, cacheError);
    }

    console.log('Updating forecasts with new transaction data');
    let forecastUpdate = null;
    try {
      const updatedForecasts = await updateForecastsService(userId, null, true);
      console.log('Forecasts updated successfully', {
        forecastMethod: updatedForecasts.forecastMethod,
        confidenceScore: updatedForecasts.confidenceScore,
        lastUpdated: updatedForecasts.lastUpdated,
      });

      const nextMonthForecast =
        updatedForecasts.budgetForecasts && updatedForecasts.budgetForecasts.length > 0
          ? updatedForecasts.budgetForecasts[0]
          : null;

      forecastUpdate = {
        updated: true,
        method: updatedForecasts.forecastMethod,
        confidence: updatedForecasts.confidenceScore,
        nextMonth: nextMonthForecast
          ? {
              month: nextMonthForecast.monthStr,
              projectedIncome: nextMonthForecast.projectedIncome,
              projectedExpense: nextMonthForecast.projectedExpense,
              projectedBalance: nextMonthForecast.projectedBalance,
            }
          : null,
      };
    } catch (forecastError) {
      console.error('Error updating forecasts (non-critical):', forecastError.message);
      forecastUpdate = { updated: false, error: forecastError.message };
    }

    return {
      transaction,
      goalAchieved: goalUpdate?.isAchieved || false,
      updatedGoal: goalUpdate?.goal,
      forecastUpdate,
    };
  } catch (error) {
    console.error('Sequential processing error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      data: transactionData,
    });
    throw error;
  }
};

export const getTransactions = async (userId) => {
  try {
    return await TransactionCollection.find({ userId }).sort({ date: -1 });
  } catch (error) {
    throw error;
  }
};
