import { ForecastCollection } from '../db/models/Forecast.js';
import { GoalCollection } from '../db/models/Goal.js';
import { TransactionCollection } from '../db/models/Transaction.js';

export const calculateBudgetForecast = async (userId, session = null) => {
  const sixMonthAgo = new Date();
  sixMonthAgo.setMonth(sixMonthAgo.getMonth() - 6);

  const transactions = await TransactionCollection.find({ userId, date: { $gte: sixMonthAgo } }).session(session);

  const monthlyStats = transactions.reduce(
    (acc, t) => {
      const amount = Number(t.amount);
      if (t.type === 'expense') {
        acc.avgExpense += amount / 6;
      } else {
        acc.avgIncome += amount / 6;
      }
      return acc;
    },
    { avgExpense: 0, avgIncome: 0 },
  );

  return Array.from({ length: 6 }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() + i + 1);
    const trendFactor = 1 + i * 0.02;
    return {
      date,
      projectedExpense: monthlyStats.avgExpense * trendFactor,
      projectedIncome: monthlyStats.avgIncome * trendFactor,
      projectedBalance: (monthlyStats.avgIncome - monthlyStats.avgExpense) * trendFactor,
    };
  });
};

const calculateGoalForecast = async (userId, session = null) => {
  const activeGoal = await GoalCollection.findOne({ userId, isActive: true }).session(session);

  if (!activeGoal) return null;

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const transactions = await TransactionCollection.find({ userId, date: { $gte: threeMonthsAgo } }).session(session);

  const monthlySavings =
    transactions.reduce((acc, t) => (t.type === 'income' ? acc + t.amount : acc - t.amount), 0) / 3;

  const remaining = activeGoal.targetAmount - activeGoal.currentAmount;
  const monthsToGoal = Math.ceil(remaining / monthlySavings);

  const projectedDate = new Date();
  projectedDate.setMonth(projectedDate.getMonth() + monthsToGoal);

  return {
    goalId: activeGoal._id,
    monthsToGoal,
    projectedDate,
    monthlySavings,
    probability: monthlySavings > 0 ? Math.min((monthlySavings / remaining) * 100, 100) : 0,
  };
};

export const updateForecasts = async (userId, session = null) => {
  const budgetForecasts = await calculateBudgetForecast(userId, session);
  const goalForecast = await calculateGoalForecast(userId, session);

  return await ForecastCollection.findOneAndUpdate(
    { userId },
    {
      budgetForecasts,
      goalForecast,
      lastUpdated: new Date(),
    },
    { upsert: true, new: true, session },
  );
};
