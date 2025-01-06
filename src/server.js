import express from 'express';
import * as fs from 'fs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './utils/env.js';
import router from './routers/index.js';

const PORT = Number(env('PORT', '3000'));

export const startServer = async () => {
  const app = express();

  app.use(express.json());
  app.use(
    cors({
      origin: ['https://finance-manager-front.vercel.app', 'http://localhost:5174'],
      credentials: true,
    }),
  );
  app.use(cookieParser());

  app.use('/', router);

  app.use('*', (req, res, next) => {
    res.status(404).json({
      message: `Route ${req.method} ${req.originalUrl} not found`,
    });
  });

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || 'InternalServerError';
    res.status(status).json({
      status,
      message,
      data: {
        message: err.message || 'Something went wrong',
        code: err.code || null,
      },
    });
  });

  app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
  });
};
