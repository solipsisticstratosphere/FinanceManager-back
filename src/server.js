import express from 'express';
import * as fs from 'fs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './utils/env.js';
import router from './routers/index.js';
import pino from 'pino';
import pretty from 'pino-pretty';

// Настройка логера с pino-pretty
const stream = pretty();
const logger = pino(stream);

const PORT = Number(env('PORT', '3000'));

export const startServer = async () => {
  const app = express();

  // Подключаем логирование для каждого запроса
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.originalUrl}`);
    next();
  });

  app.use(express.json());
  app.use(
    cors({
      origin: ['https://finance-manager-front.vercel.app', 'http://localhost:5174'],
      credentials: true,
    }),
  );
  app.use(cookieParser());

  app.use('/', router);

  // Обработка ошибок с логированием
  app.use('*', (req, res, next) => {
    const message = `Route ${req.method} ${req.originalUrl} not found`;
    logger.error(message);
    res.status(404).json({
      message,
    });
  });

  // Универсальный обработчик ошибок
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || 'InternalServerError';
    logger.error(`Error: ${message}, Status: ${status}`);
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
    logger.info(`Server started on port ${PORT}`);
  });
};
