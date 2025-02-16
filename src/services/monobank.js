// services/monobank.js
import axios from 'axios';
import createHttpError from 'http-errors';
import MonobankToken from '../db/models/MonobankToken.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import UserCollection from '../db/models/User.js';
import mongoose from 'mongoose';
import { updateGoalProgress } from './goal.js';
import { updateForecasts } from './forecast.js';
import { mapMonoCategory } from '../utils/categoryMapper.js';

// Базовый URL API Монобанка
const MONOBANK_API_URL = 'https://api.monobank.ua';

// Функция для подключения Монобанка (сохранение токена)
export const connectMonobank = async (userId, token) => {
  try {
    // Проверяем валидность токена, запрашивая информацию о клиенте
    const clientInfo = await getMonobankClientInfo(token);

    // Шифруем токен перед сохранением
    const { encryptedToken, iv } = MonobankToken.encryptToken(token);

    // Подготавливаем данные о счетах
    const accounts = clientInfo.accounts.map((account) => ({
      id: account.id,
      name: account.maskedPan.length ? account.maskedPan[0] : 'Счет',
      balance: account.balance / 100,
      currencyCode: account.currencyCode,
    }));

    // Ищем существующую запись или создаем новую
    const tokenRecord = await MonobankToken.findOneAndUpdate(
      { userId },
      {
        encryptedToken,
        iv,
        accounts,
        userId,
      },
      {
        upsert: true,
        new: true,
      },
    );

    // Сразу выполняем синхронизацию транзакций
    await syncMonobankTransactions(userId);

    return {
      connected: true,
      accounts: tokenRecord.accounts,
    };
  } catch (error) {
    if (error.response) {
      if (error.response.status === 403) {
        throw new createHttpError(403, 'Неверный токен Монобанка');
      }
      throw new createHttpError(
        error.response.status,
        error.response.data?.errorDescription || 'Ошибка при подключении к Монобанку',
      );
    }
    throw new createHttpError(500, 'Ошибка при подключении к Монобанку');
  }
};

// Функция для отключения Монобанка (удаление токена)
export const disconnectMonobank = async (userId) => {
  const result = await MonobankToken.findOneAndDelete({ userId });
  if (!result) {
    throw new createHttpError(404, 'Подключение к Монобанку не найдено');
  }
  return { connected: false };
};

// Функция для синхронизации транзакций из Монобанка
export const syncMonobankTransactions = async (userId) => {
  let session = null;

  try {
    // Находим токен пользователя
    const tokenRecord = await MonobankToken.findOne({ userId });
    if (!tokenRecord) {
      throw new createHttpError(404, 'Подключение к Монобанку не найдено');
    }

    // Расшифровываем токен
    const token = MonobankToken.decryptToken(tokenRecord.encryptedToken, tokenRecord.iv);

    // Определяем период для синхронизации (последние 30 дней или с момента последней синхронизации)
    const currentTime = Math.floor(Date.now() / 1000);
    let fromTime;

    if (tokenRecord.lastSync) {
      // Если была предыдущая синхронизация, берем время с небольшим перекрытием (1 час)
      fromTime = Math.floor(tokenRecord.lastSync.getTime() / 1000) - 3600;
    } else {
      // Иначе берем последние 30 дней
      fromTime = currentTime - 30 * 24 * 60 * 60;
    }

    // Получаем транзакции для каждого счета
    const allTransactions = [];

    for (const account of tokenRecord.accounts) {
      if (account.currencyCode !== 980) {
        // Пропускаем не-гривневые счета (980 - код гривны)
        continue;
      }

      const monoTransactions = await getMonobankTransactions(token, account.id, fromTime);

      // Преобразуем транзакции в формат нашего приложения
      const formattedTransactions = monoTransactions.map((transaction) => {
        // Определяем тип транзакции (доход/расход)
        const type = transaction.amount > 0 ? 'income' : 'expense';

        return {
          monoId: transaction.id,
          userId,
          amount: Math.abs(transaction.amount) / 100,
          type,
          category: mapMonoCategory(transaction.mcc, type),
          description: transaction.description,
          date: new Date(transaction.time * 1000),
          source: 'monobank',
        };
      });

      allTransactions.push(...formattedTransactions);
    }

    // Если нет новых транзакций, просто обновляем время синхронизации
    if (allTransactions.length === 0) {
      await MonobankToken.findByIdAndUpdate(tokenRecord._id, {
        lastSync: new Date(),
      });

      return {
        transactionsCount: 0,
        lastSync: new Date(),
      };
    }

    // Запускаем транзакцию в MongoDB для атомарного обновления данных
    const isTransactionSupported = await checkTransactionSupport();
    if (isTransactionSupported) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    // Сохраняем транзакции и обновляем баланс
    const savedTransactions = await saveMonobankTransactions(allTransactions, userId, session);

    // Обновляем время последней синхронизации
    await MonobankToken.findByIdAndUpdate(tokenRecord._id, { lastSync: new Date() }, session ? { session } : undefined);

    if (session) {
      await session.commitTransaction();
    }

    return {
      transactionsCount: savedTransactions.length,
      lastSync: new Date(),
    };
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }

    if (error.response) {
      if (error.response.status === 403) {
        throw new createHttpError(403, 'Токен Монобанка недействителен. Пожалуйста, обновите подключение.');
      }
      throw new createHttpError(
        error.response.status,
        error.response.data?.errorDescription || 'Ошибка при синхронизации с Монобанком',
      );
    }
    throw error;
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

// Функция для получения статуса подключения к Монобанку
export const getMonobankStatus = async (userId) => {
  const tokenRecord = await MonobankToken.findOne({ userId });
  if (!tokenRecord) {
    return {
      connected: false,
    };
  }

  return {
    connected: true,
    accounts: tokenRecord.accounts,
    lastSync: tokenRecord.lastSync,
  };
};

// Вспомогательные функции

// Проверка поддержки транзакций MongoDB
const checkTransactionSupport = async () => {
  try {
    const status = await mongoose.connection.db.admin().command({ replSetGetStatus: 1 });
    return !!status;
  } catch {
    return false;
  }
};

// Получение информации о клиенте Монобанка
const getMonobankClientInfo = async (token) => {
  try {
    const response = await axios.get(`${MONOBANK_API_URL}/personal/client-info`, {
      headers: {
        'X-Token': token,
      },
    });
    return response.data;
  } catch (error) {
    throw error;
  }
};

// Получение транзакций из Монобанка
const getMonobankTransactions = async (token, accountId, fromTime) => {
  try {
    const response = await axios.get(`${MONOBANK_API_URL}/personal/statement/${accountId}/${fromTime}`, {
      headers: {
        'X-Token': token,
      },
    });
    return response.data;
  } catch (error) {
    // Если нет транзакций, возвращаем пустой массив
    if (error.response && error.response.status === 404) {
      return [];
    }
    throw error;
  }
};

// Сохранение транзакций и обновление баланса
const saveMonobankTransactions = async (transactions, userId, session) => {
  // Предварительная обработка: находим существующие транзакции, чтобы избежать дубликатов
  const existingMonoIds = await TransactionCollection.distinct('monoId', {
    userId,
    monoId: { $in: transactions.map((t) => t.monoId) },
  });

  // Фильтруем только новые транзакции
  const newTransactions = transactions.filter((t) => !existingMonoIds.includes(t.monoId));

  if (newTransactions.length === 0) {
    return [];
  }

  // Сохраняем новые транзакции
  const savedTransactions = await TransactionCollection.create(newTransactions, session ? { session } : undefined);

  // Рассчитываем общее изменение баланса
  const balanceChange = newTransactions.reduce((sum, transaction) => {
    return sum + (transaction.type === 'income' ? transaction.amount : -transaction.amount);
  }, 0);

  // Обновляем баланс пользователя
  await UserCollection.findByIdAndUpdate(
    userId,
    {
      $inc: { balance: balanceChange },
      lastBalanceUpdate: new Date(),
    },
    session ? { session } : undefined,
  );

  // Обновляем прогресс целей
  await updateGoalProgress(userId, balanceChange, session);

  // Обновляем прогнозы
  await updateForecasts(userId, session);

  return savedTransactions;
};
