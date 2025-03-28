import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import { getForecastsController, getDetailedForecastController } from '../controllers/forecast.js';
import { updateUserForecast } from '../controllers/forecasts.js';

const forecastRouter = Router();

forecastRouter.get('/', authenticate, ctrlWrapper(getForecastsController));
forecastRouter.get('/detailed', authenticate, ctrlWrapper(getDetailedForecastController));
forecastRouter.post('/update', authenticate, ctrlWrapper(updateUserForecast));

export default forecastRouter;
