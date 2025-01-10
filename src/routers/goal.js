import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import validateBody from '../utils/validateBody.js';
import { goalValidationSchema } from '../validation/goal.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import {
  createGoalController,
  deactivateGoalController,
  deleteGoalController,
  getGoalsController,
  setActiveGoalController,
} from '../controllers/goal.js';

const goalRouter = Router();

goalRouter.post('/', authenticate, validateBody(goalValidationSchema), ctrlWrapper(createGoalController));
goalRouter.get('/', authenticate, ctrlWrapper(getGoalsController));
goalRouter.patch('/:goalId/activate', authenticate, ctrlWrapper(setActiveGoalController));
goalRouter.patch('/:goalId/deactivate', authenticate, ctrlWrapper(deactivateGoalController));
goalRouter.delete('/:goalId', authenticate, ctrlWrapper(deleteGoalController));
export default goalRouter;
