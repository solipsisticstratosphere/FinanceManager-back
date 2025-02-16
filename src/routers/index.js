import { Router } from 'express';
import authRouter from './auth.js';
import usersRouter from './users.js';
import balanceRouter from './balance.js';
import transactionsRouter from './transactions.js';
import goalRouter from './goal.js';
import forecastRouter from './forecasts.js';
import monobankRouter from './monobank.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/balance', balanceRouter);
router.use('/transactions', transactionsRouter);
router.use('/goal', goalRouter);
router.use('/forecasts', forecastRouter);
app.use('/api/monobank', monobankRouter);
export default router;
