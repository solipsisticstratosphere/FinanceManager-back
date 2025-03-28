import AdvancedMachineLearningForecastService from './AIForecastService.js'; // Путь к новому сервису

export const updateForecasts = async (userId, session = null) => {
  if (session) {
    return await AdvancedMachineLearningForecastService.updateForecasts(userId, session);
  } else {
    return await AdvancedMachineLearningForecastService.updateForecasts(userId);
  }
};
