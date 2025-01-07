import { Router } from 'express';
import validateBody from '../utils/validateBody.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import {
  loginController,
  logoutController,
  refreshSessionController,
  registerController,
} from '../controllers/auth.js';
import { loginUserSchema, registerUserSchema } from '../validation/auth.js';

const authRouter = Router();

authRouter.post('/register', validateBody(registerUserSchema), ctrlWrapper(registerController));
authRouter.post('/login', validateBody(loginUserSchema), ctrlWrapper(loginController));
authRouter.post('/refresh', ctrlWrapper(refreshSessionController));
authRouter.post('/logout', ctrlWrapper(logoutController));
export default authRouter;
