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

// Подключение Монобанка (сохранение токена)
monobankRouter.post(
  '/connect',
  authenticate,
  validateBody(monobankTokenSchema),
  ctrlWrapper(connectMonobankController),
);

// Отключение Монобанка (удаление токена)
monobankRouter.delete('/disconnect', authenticate, ctrlWrapper(disconnectMonobankController));

// Ручная синхронизация транзакций
monobankRouter.post('/sync', authenticate, ctrlWrapper(syncMonobankTransactionsController));

// Получение статуса подключения к Монобанку
monobankRouter.get('/status', authenticate, ctrlWrapper(getMonobankStatusController));

export default monobankRouter;
