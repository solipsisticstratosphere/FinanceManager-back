import createHttpError from 'http-errors';
import { cropUserData } from '../utils/cropUserData.js';
import UserCollection from '../db/models/User.js';
import bcrypt from 'bcrypt';
export const getUserController = async (req, res) => {
  const user = req.user;

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  res.status(200).json({ status: 200, message: 'User found', data: cropUserData(user) });
};

export const updateUserSettings = async (req, res) => {
  const { _id } = req.user;
  const { name, email, currentPassword, newPassword, currency } = req.body;

  const updateData = {};

  if (email) {
    const existingUser = await UserCollection.findOne({ email, _id: { $ne: _id } });
    if (existingUser) {
      throw createHttpError(409, 'Email already in use');
    }
    updateData.email = email;
  }

  if (name !== undefined) {
    updateData.name = name;
  }

  if (currency) {
    if (!['UAH', 'USD', 'EUR'].includes(currency)) {
      throw createHttpError(400, 'Invalid currency');
    }
    updateData.currency = currency;
  }

  if (currentPassword && newPassword) {
    const user = await UserCollection.findById(_id);
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isPasswordValid) {
      throw createHttpError(401, 'Current password is incorrect');
    }

    if (newPassword.length < 6) {
      throw createHttpError(400, 'New password must be at least 6 characters long');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    updateData.password = hashedPassword;
  }

  const updatedUser = await UserCollection.findByIdAndUpdate(_id, { $set: updateData }, { new: true });

  if (!updatedUser) {
    throw createHttpError(404, 'User not found');
  }

  res.status(200).json({
    status: 200,
    message: 'Settings updated successfully',
    data: cropUserData(updatedUser),
  });
};
