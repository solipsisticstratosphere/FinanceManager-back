import { createGoal, deactivateGoal, deleteGoal, getGoals, setActiveGoal } from '../services/goal.js';

export const createGoalController = async (req, res) => {
  const { _id: userId } = req.user;
  const goal = await createGoal({ ...req.body, userId });
  res.status(201).json({ status: 201, message: 'Goal created', data: goal });
};

export const getGoalsController = async (req, res) => {
  const { _id: userId } = req.user;
  const goals = await getGoals(userId);
  res.status(200).json({ status: 200, message: 'Goals found', data: goals });
};

export const setActiveGoalController = async (req, res) => {
  const { _id: userId } = req.user;
  const { goalId } = req.params;
  const goal = await setActiveGoal(userId, goalId);
  res.status(200).json({ status: 200, message: 'Goal activated', data: goal });
};

export const deactivateGoalController = async (req, res) => {
  const { _id: userId } = req.user;
  const { goalId } = req.params;
  const goal = await deactivateGoal(userId, goalId);
  res.status(200).json({ status: 200, message: 'Goal deactivated', data: goal });
};

export const deleteGoalController = async (req, res) => {
  const { _id: userId } = req.user;
  const { goalId } = req.params;
  const goal = await deleteGoal(userId, goalId);
  res.status(200).json({ status: 200, message: 'Goal deleted', data: goal });
};
