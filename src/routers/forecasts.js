import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import ctrlWrapper from '../utils/crtlWrapper.js';
import { getForecastsController } from '../controllers/forecast.js';

const forecastRouter = Router();

forecastRouter.get('/', authenticate, ctrlWrapper(getForecastsController));

export default forecastRouter;
