import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import { getUserController, updateUserSettings } from '../controllers/user.js';
import { updateUserAverages } from '../controllers/users.js';

const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get('/current', ctrlWrapper(getUserController));
usersRouter.patch('/settings', ctrlWrapper(updateUserSettings));
// Special admin route to update all users' income/expense averages
usersRouter.post('/update-averages', ctrlWrapper(updateUserAverages));

export default usersRouter;
