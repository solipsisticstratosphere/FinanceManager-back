import UserCollection from '../db/models/User.js';
import { TransactionCollection } from '../db/models/Transaction.js';
import { subMonths } from 'date-fns';

class UserService {
  async getUserById(id) {
    return UserCollection.findById(id);
  }

  async updateUserBalance(userId, newBalance) {
    return UserCollection.findByIdAndUpdate(
      userId,
      {
        balance: newBalance,
        lastBalanceUpdate: new Date(),
      },
      { new: true },
    );
  }

  async updateUserAverages(userId) {
    try {
      // Get transactions from the last 3 months
      const startDate = subMonths(new Date(), 3);

      const transactionStats = await TransactionCollection.aggregate([
        {
          $match: {
            userId,
            date: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: '$type',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]);

      // Extract monthly averages from the stats
      let monthlyExpense = 0;
      let monthlyIncome = 0;

      transactionStats.forEach((stat) => {
        // Convert total to monthly average (divide by 3 for 3 months)
        const monthlyAverage = stat.total / 3;

        if (stat._id === 'expense') {
          monthlyExpense = monthlyAverage;
        } else if (stat._id === 'income') {
          monthlyIncome = monthlyAverage;
        }
      });

      // Update user with new averages
      const updatedUser = await UserCollection.findByIdAndUpdate(
        userId,
        {
          averageMonthlyExpense: monthlyExpense,
          averageMonthlyIncome: monthlyIncome,
        },
        { new: true },
      );

      return updatedUser;
    } catch (error) {
      console.error('Error updating user averages:', error);
      throw error;
    }
  }
}

export default new UserService();
