import { access } from 'fs';
import * as authServices from '../services/auth.js';
import { cropUserData } from '../utils/cropUserData.js';

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
  if (req.cookies.sessionId) {
    await authServices.logout(req.cookies.sessionId);
  }

  res.clearCookie('sessionId');
  res.clearCookie('refreshToken');
  res.status(204).send();
};
