import { Router } from 'express';
import validateBody from '../utils/validateBody.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import {
  getGoogleOAuthUrlController,
  loginController,
  loginWithGoogleController,
  logoutController,
  refreshSessionController,
  registerController,
} from '../controllers/auth.js';
import { loginUserSchema, loginWithGoogleOAuthSchema, registerUserSchema } from '../validation/auth.js';

const authRouter = Router();

authRouter.post('/register', validateBody(registerUserSchema), ctrlWrapper(registerController));
authRouter.post('/login', validateBody(loginUserSchema), ctrlWrapper(loginController));
authRouter.post('/refresh', ctrlWrapper(refreshSessionController));
authRouter.post('/logout', ctrlWrapper(logoutController));
authRouter.get('/get-oauth-url', ctrlWrapper(getGoogleOAuthUrlController));
authRouter.post('/confirm-oauth', validateBody(loginWithGoogleOAuthSchema), ctrlWrapper(loginWithGoogleController));
export default authRouter;
