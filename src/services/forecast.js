import AdvancedMachineLearningForecastService from './AIForecastService.js'; // Путь к новому сервису

export const updateForecasts = async (userId, session = null, detailed = false) => {
  if (session) {
    return await AdvancedMachineLearningForecastService.updateForecasts(userId, session, detailed);
  } else {
    return await AdvancedMachineLearningForecastService.updateForecasts(userId, null, detailed);
  }
};
