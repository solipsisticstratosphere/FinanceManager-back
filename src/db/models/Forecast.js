import mongoose from 'mongoose';

const forecastSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    budgetForecasts: [
      {
        date: Date,
        projectedExpense: Number,
        projectedIncome: Number,
        projectedBalance: Number,
      },
    ],
    goalForecast: {
      goalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Goal',
      },
      monthsToGoal: Number,
      projectedDate: Date,
      monthlySavings: Number,
      probability: Number,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false, timestamps: true },
);

export const ForecastCollection = mongoose.model('Forecast', forecastSchema);
