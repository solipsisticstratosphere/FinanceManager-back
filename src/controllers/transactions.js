import { addTransaction, getTransactions } from '../services/transactions.js';

export const addTransactionController = async (req, res) => {
  const { _id: userId } = req.user;
  const result = await addTransaction({ ...req.body, userId });

  const response = {
    status: 201,
    message: 'Transaction added',
    data: result.transaction,
  };

  if (result.goalAchieved) {
    response.goal = {
      achieved: true,
      goalData: result.updatedGoal,
    };
  }

  res.status(201).json(response);
};

export const getTransactionsController = async (req, res) => {
  const { _id: userId } = req.user;
  const transactions = await getTransactions(userId);
  res.status(200).json({ status: 200, message: 'Transactions found', data: transactions });
};
