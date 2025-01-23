import mongoose from 'mongoose';
import UserCollection from '../db/models/User.js';
import createHttpError from 'http-errors';
import { TransactionCollection } from '../db/models/Transaction.js';
import { updateGoalProgress } from './goal.js';
import { updateForecasts } from './forecast.js';

export const addTransaction = async (transactionData) => {
  let session = null;
  try {
    const isTransactionSupported = await checkTransactionSupport();
    if (!isTransactionSupported) {
      return await processWithoutTransaction(transactionData);
    }

    session = await mongoose.startSession();
    session.startTransaction();
    const result = await processWithTransaction(transactionData, session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

const checkTransactionSupport = async () => {
  try {
    const status = await mongoose.connection.db.admin().command({ replSetGetStatus: 1 });
    return !!status;
  } catch {
    return false;
  }
};

const processWithoutTransaction = async (transactionData) => {
  const user = await UserCollection.findById(transactionData.userId);
  if (!user) {
    throw new createHttpError(404, 'User not found');
  }

  const amount = Number(transactionData.amount);
  if (transactionData.type === 'expense' && user.balance < amount) {
    throw new createHttpError(400, 'Not enough balance');
  }

  const transaction = await TransactionCollection.create(transactionData);
  const balanceChange = transactionData.type === 'income' ? amount : -amount;

  await UserCollection.findByIdAndUpdate(transactionData.userId, {
    $inc: { balance: balanceChange },
    lastBalanceUpdate: new Date(),
  });

  const goalUpdate = await updateGoalProgress(transactionData.userId, balanceChange);
  await updateForecasts(transactionData.userId);

  return {
    transaction,
    goalAchieived: goalUpdate?.isAchieved || false,
    updatedGoal: goalUpdate?.goal,
  };
};

const processWithTransaction = async (transactionData, session) => {
  const user = await UserCollection.findById(transactionData.userId).session(session);
  if (!user) {
    throw new createHttpError(404, 'User not found');
  }

  const amount = Number(transactionData.amount);
  if (transactionData.type === 'expense' && user.balance < amount) {
    throw new createHttpError(400, 'Not enough balance');
  }

  const transaction = await TransactionCollection.create([transactionData], { session });
  const balanceChange = transactionData.type === 'income' ? amount : -amount;

  await UserCollection.findByIdAndUpdate(
    transactionData.userId,
    {
      $inc: { balance: balanceChange },
      lastBalanceUpdate: new Date(),
    },
    { session },
  );

  // Важно: передаем сессию во все операции внутри транзакции
  const goalUpdate = await updateGoalProgress(transactionData.userId, balanceChange, session);
  await updateForecasts(transactionData.userId, session); // Добавляем session параметр

  return {
    transaction: transaction[0],
    goalAchieved: goalUpdate?.isAchieved || false,
    updatedGoal: goalUpdate?.goal,
  };
};

export const getTransactions = async (userId) => {
  try {
    return await TransactionCollection.find({ userId }).sort({ date: -1 });
  } catch (error) {
    throw error;
  }
};
