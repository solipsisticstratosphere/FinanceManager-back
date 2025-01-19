import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import { getUserController, updateUserSettings } from '../controllers/user.js';

const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get('/current', ctrlWrapper(getUserController));
usersRouter.patch('/settings', ctrlWrapper(updateUserSettings));

export default usersRouter;
