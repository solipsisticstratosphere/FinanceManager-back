import { updateForecasts, getGoalForecasts, getCategoryForecasts, getQuickEstimates } from '../services/forecast.js';

export const getForecastsController = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const forecasts = await updateForecasts(userId);

    res.status(200).json({
      status: 200,
      message: 'Forecasts found',
      data: forecasts,
      meta: {
        forecastVersion: forecasts.forecastMethod,
        confidence: forecasts.confidenceScore || null,
        lastUpdated: forecasts.lastUpdated,
      },
    });
  } catch (error) {
    console.error('Error in forecast controller:', error);
    res.status(500).json({
      status: 500,
      message: 'Failed to generate forecasts',
      error: error.message,
    });
  }
};

export const getQuickEstimatesController = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const quickEstimates = await getQuickEstimates(userId);

    res.status(200).json({
      status: 200,
      message: 'Quick estimates found',
      data: quickEstimates,
      meta: {
        lastUpdated: quickEstimates.lastUpdated,
        calculationStatus: quickEstimates.calculationStatus,
        calculationProgress: quickEstimates.calculationProgress,
      },
    });
  } catch (error) {
    console.error('Error in quick estimates controller:', error);
    res.status(500).json({
      status: 500,
      message: 'Failed to generate quick estimates',
      error: error.message,
    });
  }
};

export const getGoalForecastsController = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const goalForecasts = await getGoalForecasts(userId);

    if (!goalForecasts) {
      return res.status(404).json({
        status: 404,
        message: 'No active goal forecasts found',
        data: null,
      });
    }

    res.status(200).json({
      status: 200,
      message: 'Goal forecasts found',
      data: goalForecasts,
      meta: {
        lastUpdated: goalForecasts.lastUpdated,
      },
    });
  } catch (error) {
    console.error('Error in goal forecast controller:', error);
    res.status(500).json({
      status: 500,
      message: 'Failed to generate goal forecasts',
      error: error.message,
    });
  }
};

export const getCategoryForecastsController = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const { category } = req.query;

    const categoryForecasts = await getCategoryForecasts(userId, category);

    if (!categoryForecasts || categoryForecasts.categories.length === 0) {
      return res.status(404).json({
        status: 404,
        message: category ? `No forecasts found for category "${category}"` : 'No category forecasts found',
        data: null,
      });
    }

    res.status(200).json({
      status: 200,
      message: 'Category forecasts found',
      data: categoryForecasts,
      meta: {
        lastUpdated: categoryForecasts.lastUpdated,
      },
    });
  } catch (error) {
    console.error('Error in category forecast controller:', error);
    res.status(500).json({
      status: 500,
      message: 'Failed to generate category forecasts',
      error: error.message,
    });
  }
};
