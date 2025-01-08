import createHttpError from 'http-errors';
import UserCollection from '../db/models/User.js';

import mongoose from 'mongoose';

export const updateBalance = async (userId, balance) => {
  const user = await UserCollection.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(userId) },
    {
      $set: {
        balance: balance,
        lastBalanceUpdate: new Date(),
      },
    },
    { new: true },
  );

  if (!user) {
    throw new createHttpError(404, 'User not found');
  }

  return user;
};

export const getBalance = async (userId) => {
  const user = await UserCollection.findById(new mongoose.Types.ObjectId(userId));
  if (!user) {
    throw new createHttpError(404, 'User not found');
  }
  return user.balance;
};
