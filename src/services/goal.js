import createHttpError from 'http-errors';
import { GoalCollection } from '../db/models/Goal.js';
import mongoose from 'mongoose';

export const createGoal = async (goalData) => {
  const exisingActiveGoal = await GoalCollection.findOne({ userId: goalData.userId, isActive: true });
  if (exisingActiveGoal && goalData.isActive) {
    throw new createHttpError(400, 'You already have an active goal');
  }
  return await GoalCollection.create(goalData);
};

export const updateGoalProgress = async (userId, balanceChange) => {
  const activeGoal = await GoalCollection.findOne({ userId, isActive: true });
  if (!activeGoal) return null;

  if (balanceChange > 0) {
    const newAmount = Math.min(activeGoal.currentAmount + balanceChange, activeGoal.targetAmount);
    const highestAmount = Math.max(newAmount, activeGoal.highestAmount);

    const updatedGoal = await GoalCollection.findByIdAndUpdate(
      activeGoal._id,
      {
        currentAmount: newAmount,
        highestAmount: highestAmount,

        isActive: newAmount < activeGoal.targetAmount,
      },
      { new: true },
    );

    return {
      goal: updatedGoal,
      isAchieved: newAmount >= activeGoal.targetAmount,
    };
  } else {
    const potentialNewAmount = activeGoal.currentAmount + balanceChange;
    if (potentialNewAmount < activeGoal.highestAmount) {
      return {
        goal: await GoalCollection.findByIdAndUpdate(
          activeGoal._id,
          { currentAmount: potentialNewAmount },
          { new: true },
        ),
        isAchieved: false,
      };
    }
  }

  return { goal: activeGoal, isAchieved: false };
};

export const getGoals = async (userId) => {
  return await GoalCollection.find({ userId }).sort({ createdAt: -1 });
};

export const setActiveGoal = async (userId, goalId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await GoalCollection.updateMany({ userId }, { isActive: false }, { session });
    const goal = await GoalCollection.findByIdAndUpdate(
      { _id: goalId, userId },
      { isActive: true },
      { new: true, session },
    );

    if (!goal) {
      throw new createHttpError(404, 'Goal not found');
    }

    await session.commitTransaction();
    return goal;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const deactivateGoal = async (userId, goalId) => {
  const goal = await GoalCollection.findOneAndUpdate({ _id: goalId, userId }, { isActive: false }, { new: true });
  if (!goal) throw new createHttpError(404, 'Goal not found');
  return goal;
};

export const deleteGoal = async (userId, goalId) => {
  const goal = await GoalCollection.findOneAndDelete({ _id: goalId, userId });
  if (!goal) throw new createHttpError(404, 'Goal not found');
  return goal;
};