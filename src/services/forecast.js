import AIForecastService from './AIForecastService.js'; // Путь к новому сервису

export const updateForecasts = async (userId, session = null) => {
  if (session) {
    return await AIForecastService.updateForecasts(userId, session);
  } else {
    return await AIForecastService.updateForecasts(userId);
  }
};
