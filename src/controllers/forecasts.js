import { ForecastCollection } from '../db/models/Forecast.js';
import AIForecastService from '../services/AIForecastService.js';
import UserService from '../services/UserService.js';

export const updateUserForecast = async (req, res) => {
  try {
    const { _id: userId } = req.user;

    // First update the user's average income and expense
    await UserService.updateUserAverages(userId);

    // Then generate a new forecast using the updated averages
    const updatedForecast = await AIForecastService.updateForecasts(userId, null, true);

    return res.status(200).json({
      status: 200,
      message: 'Forecast updated successfully',
      data: updatedForecast,
      meta: {
        lastUpdated: updatedForecast.lastUpdated,
        forecastMethod: updatedForecast.forecastMethod,
      },
    });
  } catch (error) {
    console.error('Error updating forecast:', error);
    return res.status(500).json({
      status: 500,
      message: 'Failed to update forecast',
      error: error.message,
    });
  }
};
