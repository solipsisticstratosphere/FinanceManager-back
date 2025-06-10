import { access } from 'fs';
import * as authServices from '../services/auth.js';
import { cropUserData } from '../utils/cropUserData.js';
import { generateAuthUrl } from '../utils/googleOAuth2.js';

const setupSession = (res, session) => {
  const { _id, refreshToken, refreshTokenValidUntil } = session;
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    expires: refreshTokenValidUntil,
  });
  res.cookie('sessionId', _id, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    expires: refreshTokenValidUntil,
  });
};

export const registerController = async (req, res) => {
  const user = await authServices.register(req.body);
  const { session } = await authServices.login(req.body);

  res.status(201).json({
    status: 201,
    message: 'Successfully registered and logged in',
    data: { accessToken: session.accessToken, user: cropUserData(user) },
  });
};

export const loginController = async (req, res) => {
  const { session, user } = await authServices.login(req.body);
  setupSession(res, session);
  res.status(200).json({
    status: 200,
    message: 'Successfully logged in',
    data: { accessToken: session.accessToken, user: cropUserData(user) },
  });
};

export const refreshSessionController = async (req, res) => {
  const session = await authServices.refreshUserSession(req.cookies);
  setupSession(res, session);
  res
    .status(200)
    .json({ status: 200, message: 'Successfully refreshed session', data: { accessToken: session.accessToken } });
};

export const logoutController = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    await authServices.logout(token);

    res.clearCookie('refreshToken');
    res.clearCookie('accessToken');

    return res.status(200).json({
      status: 200,
      message: 'Successfully logged out',
    });
  } catch (error) {
    console.error('Logout controller error:', error);
    const status = error.status || 500;
    return res.status(status).json({
      status,
      message: error.message || 'Internal server error during logout',
    });
  }
};

export const getGoogleOAuthUrlController = async (req, res) => {
  const url = generateAuthUrl();

  res.json({
    status: 200,
    message: 'Successfully get Google OAuth url',
    data: { url },
  });
};

export const loginWithGoogleController = async (req, res, next) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        status: 400,
        message: 'Authorization code is required',
        data: { errors: { code: ['Authorization code is required'] } },
      });
    }

    const result = await authServices.loginOrSignupWithGoogle(code);
    setupSession(res, result);

    return res.status(200).json({
      status: 200,
      message: 'Successfully logged in with Google',
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  } catch (error) {
    next(error);
  }
};
