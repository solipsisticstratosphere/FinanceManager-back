// controllers/monobank.js
import {
  connectMonobank,
  disconnectMonobank,
  syncMonobankTransactions,
  getMonobankStatus,
} from '../services/monobank.js';

export const connectMonobankController = async (req, res) => {
  const { _id: userId } = req.user;
  const { token } = req.body;

  const result = await connectMonobank(userId, token);

  res.status(201).json({
    status: 201,
    message: 'Монобанк успешно подключен',
    data: {
      connected: true,
      accounts: result.accounts,
    },
  });
};

export const disconnectMonobankController = async (req, res) => {
  const { _id: userId } = req.user;

  await disconnectMonobank(userId);

  res.status(200).json({
    status: 200,
    message: 'Монобанк успешно отключен',
    data: {
      connected: false,
    },
  });
};

export const syncMonobankTransactionsController = async (req, res) => {
  const { _id: userId } = req.user;

  const result = await syncMonobankTransactions(userId);

  res.status(200).json({
    status: 200,
    message: 'Транзакции успешно синхронизированы',
    data: {
      transactionsCount: result.transactionsCount,
      lastSync: result.lastSync,
    },
  });
};

export const getMonobankStatusController = async (req, res) => {
  const { _id: userId } = req.user;

  const status = await getMonobankStatus(userId);

  res.status(200).json({
    status: 200,
    message: 'Статус подключения Монобанка получен',
    data: status,
  });
};
