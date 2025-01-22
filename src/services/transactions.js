import mongoose from 'mongoose';
import UserCollection from '../db/models/User.js';
import createHttpError from 'http-errors';
import { TransactionCollection } from '../db/models/Transaction.js';
import { updateGoalProgress } from './goal.js';
import { updateForecasts } from './forecast.js';

export const addTransaction = async (transactionData) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await UserCollection.findById(transactionData.userId);
    if (!user) {
      throw new createHttpError(404, 'User not found');
    }

    const amount = Number(transactionData.amount);
    if (transactionData.type === 'expense') {
      if (user.balance < amount) {
        throw new createHttpError(400, 'Not enough balance');
      }
    }

    const transaction = await TransactionCollection.create([transactionData], { session });

    const balanceChange = transactionData.type === 'income' ? amount : -amount;
    await UserCollection.findByIdAndUpdate(
      transactionData.userId,
      { $inc: { balance: balanceChange }, lastBalanceUpdate: new Date() },
      { session },
    );

    const goalUpdate = await updateGoalProgress(transactionData.userId, balanceChange);
    await updateForecasts(transactionData.userId);

    await session.commitTransaction();

    return {
      transaction: transaction[0],
      goalAchieved: goalUpdate?.isAchieved || false,
      updatedGoal: goalUpdate?.goal,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
export const getTransactions = async (userId) => {
  const transactions = await TransactionCollection.find({ userId }).sort({ date: -1 });
  return transactions;
};
