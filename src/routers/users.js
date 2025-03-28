import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import { getUserController, updateUserSettings } from '../controllers/user.js';
import { updateUserAverages, updateCurrentUserAverages } from '../controllers/users.js';

const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get('/current', ctrlWrapper(getUserController));
usersRouter.patch('/settings', ctrlWrapper(updateUserSettings));
// Special admin route to update all users' income/expense averages
usersRouter.post('/update-averages', ctrlWrapper(updateUserAverages));
// Update just the current user's averages
usersRouter.post('/update-my-averages', ctrlWrapper(updateCurrentUserAverages));

export default usersRouter;
