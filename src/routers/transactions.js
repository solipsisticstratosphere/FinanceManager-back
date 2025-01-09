import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import validateBody from '../utils/validateBody.js';
import { transactionValidationSchema } from '../validation/transaction.js';
import { addTransactionController, getTransactionsController } from '../controllers/transactions.js';
import ctrlWrapper from '../utils/crtlWrapper.js';

const transactionsRouter = Router();

transactionsRouter.post(
  '/',
  authenticate,
  validateBody(transactionValidationSchema),
  ctrlWrapper(addTransactionController),
);
transactionsRouter.get('/', authenticate, ctrlWrapper(getTransactionsController));
export default transactionsRouter;
