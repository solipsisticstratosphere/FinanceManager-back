import mongoose from 'mongoose';
import UserCollection from '../db/models/User.js';
import createHttpError from 'http-errors';
import { TransactionCollection } from '../db/models/Transaction.js';
import { updateGoalProgress } from './goal.js';
import { updateForecasts } from './forecast.js';

export const addTransaction = async (transactionData) => {
  try {
    console.log('Starting transaction process with data:', JSON.stringify(transactionData));

    // Validate user exists and get current state
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

    // Validate transaction data
    const amount = Number(transactionData.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new createHttpError(400, 'Invalid amount');
    }

    if (transactionData.type === 'expense' && user.balance < amount) {
      throw new createHttpError(400, 'Not enough balance');
    }

    // Process each step sequentially without MongoDB transactions
    return await processSequentially(transactionData);
  } catch (error) {
    console.error('Transaction service error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      data: transactionData,
      errorDetails: error.details || error.cause || error,
    });

    // Re-throw with more context
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

    // Step 1: Create the transaction
    console.log('Creating transaction document');
    const transaction = await TransactionCollection.create(transactionData);
    console.log('Transaction created:', transaction._id);

    // Step 2: Update user balance
    const balanceChange = transactionData.type === 'income' ? amount : -amount;
    console.log('Updating user balance:', { balanceChange });

    const updatedUser = await UserCollection.findByIdAndUpdate(
      transactionData.userId,
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

    // Step 3: Update goal progress
    console.log('Updating goal progress');
    let goalUpdate = null;
    try {
      goalUpdate = await updateGoalProgress(transactionData.userId, balanceChange);
      console.log('Goal progress updated successfully');
    } catch (goalError) {
      console.error('Error updating goal progress (continuing):', goalError.message);
    }

    // Step 4: Update forecasts
    console.log('Updating forecasts');
    try {
      await updateForecasts(transactionData.userId);
      console.log('Forecasts updated successfully');
    } catch (forecastError) {
      console.error('Error updating forecasts (non-critical):', forecastError.message);
      // Continue processing - forecast failure shouldn't stop transaction
    }

    return {
      transaction,
      goalAchieved: goalUpdate?.isAchieved || false,
      updatedGoal: goalUpdate?.goal,
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

// Keep these for compatibility with existing code
export const getTransactions = async (userId) => {
  try {
    return await TransactionCollection.find({ userId }).sort({ date: -1 });
  } catch (error) {
    throw error;
  }
};
