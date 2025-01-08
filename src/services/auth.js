import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { accessTokenLifetime, refreshTokenLifetime } from '../constants/index.js';
import UserCollection from '../db/models/User.js';
import createHttpError from 'http-errors';
import SessionCollection from '../db/models/Session.js';

const createSession = () => {
  const accessToken = randomBytes(30).toString('base64');
  const refreshToken = randomBytes(30).toString('base64');
  return {
    accessToken,
    refreshToken,
    accessTokenValidUntil: Date.now() + accessTokenLifetime,
    refreshTokenValidUntil: Date.now() + refreshTokenLifetime,
  };
};

export const register = async (payload) => {
  const { email, password } = payload;
  const user = await findUser({ email });
  if (user) {
    throw new Error('Email already used');
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = await UserCollection.create({ ...payload, password: hashedPassword, balance: 0 });
  return newUser;
};

export const login = async ({ email, password }) => {
  const user = await findUser({ email });
  if (!user) {
    throw createHttpError(401, 'Email or password is wrong');
  }
  const passwordCompare = await bcrypt.compare(password, user.password);
  if (!passwordCompare) {
    throw createHttpError(401, 'Email or password is wrong');
  }
  await SessionCollection.deleteOne({ userId: user._id });
  const newSession = createSession();

  const createdSession = await SessionCollection.create({ userId: user._id, ...newSession });
  return { session: createdSession, user };
};

export const logout = async (sessionId) => {
  await SessionCollection.deleteOne({ _id: sessionId });
};

export const refreshUserSession = async ({ sessionId, refreshToken }) => {
  const session = await SessionCollection.findOne({ _id: sessionId, refreshToken });
  if (!session) {
    throw createHttpError(401, 'Session not found');
  }
  if (Date.now() > session.refreshTokenValidUntil) {
    throw createHttpError(401, 'Session expired');
  }
  await SessionCollection.deleteOne({ userId: session.userId });
  const newSession = createSession();
  return SessionCollection.create({ userId: session.userId, ...newSession });
};
export const findSession = async (filter) => {
  try {
    const session = await SessionCollection.findOne(filter);
    if (!session) {
      console.log('Session not found for filter:', filter);
    }
    return session;
  } catch (error) {
    console.error('Error finding session:', error);
    throw new Error('Error finding session');
  }
};

export const findUser = async (filter) => {
  try {
    const user = await UserCollection.findOne(filter);
    if (!user) {
      console.log('User not found for filter:', filter);
    }
    return user;
  } catch (error) {
    console.error('Error finding user:', error);
    throw new Error('Error finding user');
  }
};
