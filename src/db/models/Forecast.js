import mongoose from 'mongoose';

// Define the risk factor schema separately
const riskFactorSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
    },
    severity: {
      type: Number,
      default: 50,
    },
    description: {
      type: String,
      default: 'Risk factor',
    },
  },
  { _id: false }, // Don't create _id for subdocuments
);

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
      riskFactors: [riskFactorSchema],
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
