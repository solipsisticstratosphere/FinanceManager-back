import Joi from 'joi';

const incomeCategories = ['Зарплата', 'Стипендія', 'Підробіток', 'Інше'];
const expenseCategories = ['Продукти', 'Транспорт', 'Розваги', 'Комунальні платежі'];

export const transactionValidationSchema = Joi.object({
  type: Joi.string().valid('income', 'expense').required().messages({
    'any.only': 'Type must be either "income" or "expense".',
    'any.required': 'Transaction type is required.',
  }),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'Amount must be a positive number.',
    'number.base': 'Amount must be a number.',
    'any.required': 'Amount is required.',
  }),
  category: Joi.string()
    .required()
    .when('type', {
      is: 'income',
      then: Joi.valid(...incomeCategories).messages({
        'any.only': `For "income" type, category must be one of: ${incomeCategories.join(', ')}.`,
        'any.required': 'Category is required.',
      }),
      otherwise: Joi.valid(...expenseCategories).messages({
        'any.only': `For "expense" type, category must be one of: ${expenseCategories.join(', ')}.`,
        'any.required': 'Category is required.',
      }),
    }),
  description: Joi.string().allow('').optional().messages({
    'string.base': 'Description must be a string.',
  }),
  date: Joi.date().optional().messages({
    'date.base': 'Date must be a valid date.',
  }),
});
