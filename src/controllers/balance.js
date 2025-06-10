import * as balanceServices from '../services/balance.js';

export const getBalanceController = async (req, res) => {
  const balance = await balanceServices.getBalance(req.user._id);
  res.status(200).json({ status: 200, message: 'Balance found', data: { balance } });
};

export const updateBalanceController = async (req, res) => {
  const { balance } = req.body;
  const updatedUser = await balanceServices.updateBalance(req.user._id, balance);
  res.status(200).json({
    status: 200,
    message: 'Balance updated',
    data: {
      balance: updatedUser.balance,
    },
  });
};
