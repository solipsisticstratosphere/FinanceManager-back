import { updateForecasts } from '../services/forecast.js';

export const getForecastsController = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const forecasts = await updateForecasts(userId);

    res.status(200).json({
      status: 200,
      message: 'Forecasts found',
      data: forecasts,
      meta: {
        lastUpdated: forecasts.lastUpdated,
        forecastMethod: forecasts.forecastMethod,
      },
    });
  } catch (error) {
    console.error('Error in getForecastsController:', error);
    res.status(500).json({
      status: 500,
      message: 'Failed to generate forecasts',
      error: error.message,
    });
  }
};

export const getDetailedForecastController = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const forecasts = await updateForecasts(userId, null, true);

    res.status(200).json({
      status: 200,
      message: 'Detailed forecasts found',
      data: forecasts,
    });
  } catch (error) {
    console.error('Error in getDetailedForecastController:', error);
    res.status(500).json({
      status: 500,
      message: 'Failed to generate detailed forecasts',
      error: error.message,
    });
  }
};
