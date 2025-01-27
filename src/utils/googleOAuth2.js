import { OAuth2Client } from 'google-auth-library';
import { env } from './env.js';

import createHttpError from 'http-errors';

const oauthConfig = {
  web: {
    client_id: env('GOOGLE_AUTH_CLIENT_ID'),
    project_id: 'financemanager-449113',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_secret: env('GOOGLE_AUTH_CLIENT_SECRET'),
    redirect_uris: [env('GOOGLE_REDIRECT_URI'), env('GOOGLE_REDIRECT_URI_LOCAL')],
  },
};

const googleOauthClient = new OAuth2Client({
  clientId: env('GOOGLE_AUTH_CLIENT_ID'),
  clientSecret: env('GOOGLE_AUTH_CLIENT_SECRET'),
  redirectUri: oauthConfig.web.redirect_uris[1],
});

export const generateAuthUrl = () =>
  googleOauthClient.generateAuthUrl({
    scope: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
    redirect_uri: oauthConfig.web.redirect_uris[1],
  });

export const validateCode = async (code) => {
  const response = await googleOauthClient.getToken(code);
  if (!response.tokens.id_token) {
    throw createHttpError(401);
  }

  const ticket = await googleOauthClient.verifyIdToken({
    idToken: response.tokens.id_token,
  });
  return ticket;
};

export const getFullNameFromGoogleTokenPayload = (payload) => {
  if (payload.name) return payload.name;
  let username = '';
  if (payload.given_name) username += payload.given_name;
  if (payload.family_name) username += payload.family_name;
  return username;
};
