import mongoose from 'mongoose';

const confidenceIntervalSchema = new mongoose.Schema(
  {
    lower: { type: Number, default: 0 },
    upper: { type: Number, default: 0 },
  },
  { _id: false },
);

const adjustmentFactorsSchema = new mongoose.Schema(
  {
    seasonality: { type: Number, default: 0 },
    trend: { type: Number, default: 0 },
    category: { type: Number, default: 0 },
    economic: { type: Number, default: 0 },
  },
  { _id: false },
);

const budgetForecastSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    projectedExpense: { type: Number, default: 0 },
    projectedIncome: { type: Number, default: 0 },
    projectedBalance: { type: Number },
    confidenceIntervals: {
      expense: { type: confidenceIntervalSchema, default: () => ({}) },
      income: { type: confidenceIntervalSchema, default: () => ({}) },
    },
    riskAssessment: { type: Number, default: 50 },
    month: { type: String },
    adjustmentFactors: { type: adjustmentFactorsSchema, default: () => ({}) },
  },
  { _id: false },
);

const milestoneForecastSchema = new mongoose.Schema(
  {
    percentage: { type: Number },
    amount: { type: Number },
    estimatedMonths: { type: Number },
    projectedDate: { type: Date },
    amountNeeded: { type: Number },
  },
  { _id: false },
);

const adjustmentSuggestionSchema = new mongoose.Schema(
  {
    type: { type: String },
    message: { type: String },
    additionalAmount: { type: Number },
    categories: { type: Array },
    currentMonthsToGoal: { type: Number },
  },
  { _id: false, strict: false },
);

const detailsSchema = new mongoose.Schema(
  {
    historicalExpenses: [Number],
    historicalIncomes: [Number],
    historicalDates: [String],
    categoryDistribution: [
      {
        category: String,
        amount: Number,
        percentage: Number,
      },
    ],
    volatilityMetrics: {
      expenseVolatility: Number,
      incomeVolatility: Number,
      netChangeVolatility: Number,
      trend: String,
    },
    seasonalPatterns: {
      quarterlyExpenses: [
        {
          quarter: String,
          average: Number,
        },
      ],
      quarterlyIncomes: [
        {
          quarter: String,
          average: Number,
        },
      ],
      highExpenseQuarter: {
        quarter: String,
        average: Number,
      },
      highIncomeQuarter: {
        quarter: String,
        average: Number,
      },
    },
  },
  { _id: false, strict: false },
);

const goalForecastSchema = new mongoose.Schema(
  {
    goalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Goal',
    },
    goalName: { type: String },
    currentAmount: { type: Number, default: 0 },
    targetAmount: { type: Number, default: 0 },
    monthsToGoal: { type: Number },
    projectedDate: { type: Date },
    monthlySavings: { type: Number, default: 0 },
    savingsVolatility: { type: Number, default: 0 },
    probability: { type: Number, default: 0 },
    isAchievable: { type: Boolean, default: false },
    milestones: [milestoneForecastSchema],
    adjustmentSuggestions: [adjustmentSuggestionSchema],
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
    budgetForecasts: [budgetForecastSchema],
    goalForecast: { type: goalForecastSchema, default: null },
    details: { type: detailsSchema },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    forecastMethod: {
      type: String,
      default: 'Advanced-AI-Enhanced-v3',
    },
  },
  { versionKey: false, timestamps: true },
);

export const ForecastCollection = mongoose.model('Forecast', forecastSchema);
