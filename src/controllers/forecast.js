import { updateForecasts } from '../services/forecast.js';

export const getForecastsController = async (req, res) => {
  const { _id: userId } = req.user;
  const forecasts = await updateForecasts(userId);
  res.status(200).json({ status: 200, message: 'Forecasts found', data: forecasts });
};
