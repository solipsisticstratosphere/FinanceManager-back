import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { accessTokenLifetime, refreshTokenLifetime } from '../constants/index.js';
import UserCollection from '../db/models/User.js';
import createHttpError from 'http-errors';
import SessionCollection from '../db/models/Session.js';
import { getFullNameFromGoogleTokenPayload, validateCode } from '../utils/googleOAuth2.js';

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

export const logout = async (sessionToken) => {
  try {
    if (!sessionToken) {
      throw createHttpError(401, 'No session token provided');
    }

    const session = await SessionCollection.findOne({
      accessToken: sessionToken,
    });

    if (!session) {
      return true;
    }

    await SessionCollection.deleteOne({ _id: session._id });
    return true;
  } catch (error) {
    console.error('Logout error:', error);
    throw createHttpError(500, 'Failed to logout properly');
  }
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

export const loginOrSignupWithGoogle = async (code) => {
  try {
    if (!code || typeof code !== 'string') {
      throw createHttpError(400, 'Invalid authorization code');
    }

    const loginTicket = await validateCode(code);
    const payload = loginTicket.getPayload();

    if (!payload || !payload.email) {
      throw createHttpError(401, 'Invalid Google token payload');
    }

    let user = await UserCollection.findOne({ email: payload.email });

    if (!user) {
      try {
        const password = await bcrypt.hash(payload.sub, 10);
        const username = getFullNameFromGoogleTokenPayload(payload);

        user = await UserCollection.create({
          email: payload.email,
          password,
          avatar_url: payload.picture || '',
          name: username,
          balance: 0,
        });
      } catch (error) {
        throw createHttpError(500, 'Failed to create user account');
      }
    }

    if (payload.picture && !user.avatar_url) {
      try {
        await UserCollection.findByIdAndUpdate(user._id, {
          avatar_url: payload.picture,
        });
        user.avatar_url = payload.picture;
      } catch (error) {
        console.error('Failed to update avatar:', error);
      }
    }

    const newSession = createSession();
    const session = await SessionCollection.create({
      userId: user._id,
      ...newSession,
    });

    return {
      accessToken: session.accessToken,
      user: {
        name: user.name,
        email: user.email,
        balance: user.balance,
        avatarUrl: user.avatar_url,
      },
    };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw createHttpError(401, 'Google authorization code expired');
    }
    throw error;
  }
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
