import { addTransaction, getTransactions } from '../services/transactions.js';

export const addTransactionController = async (req, res) => {
  const { _id: userId } = req.user;
  const transaction = await addTransaction({ ...req.body, userId });
  res.status(201).json({ status: 201, message: 'Transaction added', data: transaction });
};

export const getTransactionsController = async (req, res) => {
  const { _id: userId } = req.user;
  const transactions = await getTransactions(userId);
  res.status(200).json({ status: 200, message: 'Transactions found', data: transactions });
};
