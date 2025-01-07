import createHttpError from 'http-errors';
import { cropUserData } from '../utils/cropUserData.js';

export const getUserController = async (req, res) => {
  const user = req.user;

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  res.status(200).json({ status: 200, message: 'User found', data: cropUserData(user) });
};
