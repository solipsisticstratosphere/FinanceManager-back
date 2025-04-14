import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import {
  getForecastsController,
  getGoalForecastsController,
  getCategoryForecastsController,
  getQuickEstimatesController,
} from '../controllers/forecast.js';

const forecastRouter = Router();

forecastRouter.get('/', authenticate, ctrlWrapper(getForecastsController));
forecastRouter.get('/quick', authenticate, ctrlWrapper(getQuickEstimatesController));
forecastRouter.get('/categories', authenticate, ctrlWrapper(getCategoryForecastsController));
forecastRouter.get('/goals', authenticate, ctrlWrapper(getGoalForecastsController));

export default forecastRouter;
