import { Router } from 'express';
import authRouter from './auth.js';
import usersRouter from './users.js';
import balanceRouter from './balance.js';
import transactionsRouter from './transactions.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/balance', balanceRouter);
router.use('/transactions', transactionsRouter);
export default router;
