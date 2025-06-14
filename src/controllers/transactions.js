import mongoose from 'mongoose';
import { addTransaction, getTransactions } from '../services/transactions.js';
import { transactionValidationSchema } from '../validation/transaction.js';

export const addTransactionController = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;

    // Validate request body against schema
    const { error, value } = transactionValidationSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errorMessages = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        status: 'error',
        message: 'Validation error',
        data: null,
        errors: errorMessages,
      });
    }

    console.log('Received transaction request:', {
      body: value,
      userId,
    });

    const result = await addTransaction({ ...value, userId });

    const response = {
      status: 'success',
      message: 'Transaction added successfully',
      data: {
        transaction: {
          _id: result.transaction._id,
          type: result.transaction.type,
          amount: result.transaction.amount,
          category: result.transaction.category,
          description: result.transaction.description,
          date: result.transaction.date,
        },
        forecastUpdate: result.forecastUpdate || null,
        goalAchieved: result.goalAchieved || false,
        updatedGoal: result.updatedGoal || null,
      },
    };

    console.log('Transaction completed successfully:', response);
    return res.status(201).json(response);
  } catch (error) {
    console.error('Controller error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      body: req.body,
      userId: req.user?._id,
    });

    // Handle specific known errors
    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error',
        data: null,
        errors: Object.values(error.errors).map((err) => ({
          field: err.path,
          message: err.message,
        })),
      });
    }

    if (error.name === 'MongoError' && error.code === 11000) {
      return res.status(409).json({
        status: 'error',
        message: 'Duplicate transaction',
        data: null,
      });
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message,
        data: null,
      });
    }

    // Default error response
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null,
      errorDetails:
        process.env.NODE_ENV === 'development'
          ? {
              message: error.message,
              name: error.name,
            }
          : undefined,
    });
  }
};

export const getTransactionsController = async (req, res) => {
  const { _id: userId } = req.user;
  const transactions = await getTransactions(userId);
  res.status(200).json({ status: 200, message: 'Transactions found', data: transactions });
};
