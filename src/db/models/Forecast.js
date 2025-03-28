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
        monthStr: String,
        projectedExpense: Number,
        projectedIncome: Number,
        projectedBalance: Number,
        categoryPredictions: {
          type: mongoose.Schema.Types.Mixed,
          default: {},
        },
        confidence: {
          expense: Number,
          income: Number,
          balance: Number,
        },
        riskAssessment: Number,
      },
    ],
    goalForecast: {
      goalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Goal',
      },
      expectedMonthsToGoal: Number,
      bestCaseMonthsToGoal: Number,
      worstCaseMonthsToGoal: Number,
      projectedDate: Date,
      monthlySavings: Number,
      savingsVariability: Number,
      probability: Number,
      riskFactors: [
        {
          type: String,
          severity: Number,
          description: String,
        },
      ],
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    forecastMethod: {
      type: String,
      default: 'Advanced-AI-Enhanced-v3',
    },
    confidenceScore: {
      type: Number,
      default: 50,
    },
  },
  { versionKey: false, timestamps: true },
);

export const ForecastCollection = mongoose.model('Forecast', forecastSchema);
