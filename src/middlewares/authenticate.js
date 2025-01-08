import createHttpError from 'http-errors';
import mongoose from 'mongoose';
import { findSession, findUser } from '../services/auth.js';

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.get('Authorization');
    if (!authHeader) {
      return next(createHttpError(401, 'Authorization header not found'));
    }

    const [bearer, token] = authHeader.split(' ');
    if (bearer !== 'Bearer' || !token) {
      return next(createHttpError(401, 'Authorization header must be type Bearer'));
    }

    const session = await findSession({ accessToken: token });
    if (!session) {
      return next(createHttpError(401, 'Session not found'));
    }

    if (Date.now() > session.accessTokenValidUntil) {
      return next(
        createHttpError(401, 'Session expired', {
          code: 'TOKEN_EXPIRED',
          hint: 'Try to refresh session',
        }),
      );
    }

    if (!mongoose.Types.ObjectId.isValid(session.userId)) {
      return next(createHttpError(400, 'Invalid user ID in session'));
    }

    const user = await findUser({ _id: session.userId });
    if (!user) {
      return next(createHttpError(401, 'User not found'));
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    next(createHttpError(500, 'Internal Server Error'));
  }
};
