import { addTransaction, getTransactions } from '../services/transactions.js';
import { transactionValidationSchema } from '../validation/transaction.js';

export const addTransactionController = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;

    // Validate request body against schema
    const { error, value } = transactionValidationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        status: 'error',
        message: error.details[0].message,
        data: null,
      });
    }

    // Process transaction
    const result = await addTransaction({ ...value, userId });

    // Format successful response
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
      },
    };

    // Add goal information if relevant
    if (result.goalAchieved) {
      response.data.goal = {
        achieved: true,
        goalData: result.updatedGoal,
      };
    }

    return res.status(201).json(response);
  } catch (error) {
    console.error('Transaction error:', error);

    // Handle specific known errors
    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error',
        data: null,
        errors: Object.values(error.errors).map((err) => err.message),
      });
    }

    if (error.name === 'MongoError' && error.code === 11000) {
      return res.status(409).json({
        status: 'error',
        message: 'Duplicate transaction',
        data: null,
      });
    }

    // Handle http-errors
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
    });
  }
};

export const getTransactionsController = async (req, res) => {
  const { _id: userId } = req.user;
  const transactions = await getTransactions(userId);
  res.status(200).json({ status: 200, message: 'Transactions found', data: transactions });
};
