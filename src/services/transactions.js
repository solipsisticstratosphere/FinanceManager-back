import mongoose from 'mongoose';
import UserCollection from '../db/models/User.js';
import createHttpError from 'http-errors';
import { TransactionCollection } from '../db/models/Transaction.js';
import { updateGoalProgress } from './goal.js';
import { updateForecasts } from './forecast.js';

export const addTransaction = async (transactionData) => {
  let session = null;
  try {
    console.log('Starting transaction process with data:', JSON.stringify(transactionData));

    const isTransactionSupported = await checkTransactionSupport();
    console.log('Transaction support:', isTransactionSupported);

    if (!isTransactionSupported) {
      console.log('Processing without transaction support');
      return await processWithoutTransaction(transactionData);
    }

    session = await mongoose.startSession();
    session.startTransaction();
    console.log('Transaction session started');

    const result = await processWithTransaction(transactionData, session);
    await session.commitTransaction();
    console.log('Transaction committed successfully');

    return result;
  } catch (error) {
    console.error('Transaction service error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      data: transactionData,
    });

    if (session) {
      console.log('Aborting transaction due to error');
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (session) {
      await session.endSession();
      console.log('Transaction session ended');
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
  try {
    console.log('Finding user:', transactionData.userId);
    const user = await UserCollection.findById(transactionData.userId);

    if (!user) {
      console.log('User not found:', transactionData.userId);
      throw new createHttpError(404, 'User not found');
    }

    const amount = Number(transactionData.amount);
    console.log('Checking balance:', { userBalance: user.balance, amount });

    if (transactionData.type === 'expense' && user.balance < amount) {
      throw new createHttpError(400, 'Not enough balance');
    }

    console.log('Creating transaction document');
    const transaction = await TransactionCollection.create(transactionData);

    const balanceChange = transactionData.type === 'income' ? amount : -amount;
    console.log('Updating user balance:', { balanceChange });

    await UserCollection.findByIdAndUpdate(
      transactionData.userId,
      {
        $inc: { balance: balanceChange },
        lastBalanceUpdate: new Date(),
      },
      { new: true }, // Return updated document
    );

    console.log('Transaction processed successfully');
    return { transaction };
  } catch (error) {
    console.error('Process without transaction error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      data: transactionData,
    });
    throw error;
  }
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
