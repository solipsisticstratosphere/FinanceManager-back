import { Router } from 'express';
import authRouter from './auth.js';
import usersRouter from './users.js';
import balanceRouter from './balance.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/balance', balanceRouter);
export default router;
