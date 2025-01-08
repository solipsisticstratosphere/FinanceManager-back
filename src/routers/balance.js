import { Router } from 'express';
import ctrlWrapper from '../utils/crtlWrapper.js';
import { authenticate } from '../middlewares/authenticate.js';
import { getBalance, updateBalance } from '../services/balance.js';
import { getBalanceController, updateBalanceController } from '../controllers/balance.js';

const balanceRouter = Router();

balanceRouter.get('/', authenticate, ctrlWrapper(getBalanceController));
balanceRouter.put('/', authenticate, ctrlWrapper(updateBalanceController));

export default balanceRouter;
