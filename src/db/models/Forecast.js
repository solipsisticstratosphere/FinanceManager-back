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

// Define the quick estimate schema for immediate display
const quickEstimateSchema = new mongoose.Schema(
  {
    monthStr: String,
    projectedExpense: Number,
    projectedIncome: Number,
    projectedBalance: Number,
    confidence: Number,
    lastCalculated: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

// Define the 30-day budget forecast schema
const thirtyDayBudgetSchema = new mongoose.Schema(
  {
    projectedExpense: Number,
    projectedIncome: Number,
    projectedBalance: Number,
    confidence: Number,
    lastCalculated: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
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
    // Quick estimates for immediate display
    quickEstimates: [quickEstimateSchema],
    // 30-day budget forecast
    thirtyDayBudget: thirtyDayBudgetSchema,
    // Progressive loading status
    calculationStatus: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'failed'],
      default: 'pending',
    },
    calculationProgress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
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
      // Quick goal estimate for immediate display
      quickEstimate: {
        expectedMonthsToGoal: Number,
        monthlySavings: Number,
        probability: Number,
        lastCalculated: {
          type: Date,
          default: Date.now,
        },
      },
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    forecastMethod: {
      type: String,
      default: 'Advanced-AI-Enhanced-v4',
    },
    confidenceScore: {
      type: Number,
      default: 50,
    },
    // Performance metrics
    calculationTime: {
      type: Number,
      default: 0,
    },
    // Data quality indicators
    dataQuality: {
      transactionCount: Number,
      monthsOfData: Number,
      completeness: Number,
    },
  },
  { versionKey: false, timestamps: true },
);

// Add index for faster queries
forecastSchema.index({ userId: 1, lastUpdated: -1 });

export const ForecastCollection = mongoose.model('Forecast', forecastSchema);
