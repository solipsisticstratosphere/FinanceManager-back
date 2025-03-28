import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import {
  getForecastsController,
  getGoalForecastsController,
  getCategoryForecastsController,
} from '../controllers/forecast.js';

const forecastRouter = Router();

forecastRouter.get('/', authenticate, ctrlWrapper(getForecastsController));
forecastRouter.get('/goals', authenticate, ctrlWrapper(getGoalForecastsController));
forecastRouter.get('/categories', authenticate, ctrlWrapper(getCategoryForecastsController));

export default forecastRouter;
