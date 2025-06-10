// routes/monobankRouter.js
import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import validateBody from '../utils/validateBody.js';
import { monobankTokenSchema } from '../validation/monobank.js';
import {
  connectMonobankController,
  disconnectMonobankController,
  syncMonobankTransactionsController,
  getMonobankStatusController,
} from '../controllers/monobank.js';
import ctrlWrapper from '../utils/crtlWrapper.js';

const monobankRouter = Router();

monobankRouter.post(
  '/connect',
  authenticate,
  validateBody(monobankTokenSchema),
  ctrlWrapper(connectMonobankController),
);

monobankRouter.delete('/disconnect', authenticate, ctrlWrapper(disconnectMonobankController));

monobankRouter.post('/sync', authenticate, ctrlWrapper(syncMonobankTransactionsController));

monobankRouter.get('/status', authenticate, ctrlWrapper(getMonobankStatusController));

export default monobankRouter;
