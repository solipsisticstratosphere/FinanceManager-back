import Joi from 'joi';

const incomeCategories = ['Зарплата', 'Стипендія', 'Підробіток', 'Інше'];
const expenseCategories = ['Продукти', 'Транспорт', 'Розваги', 'Комунальні платежі'];

export const transactionValidationSchema = Joi.object({
  type: Joi.string().valid('income', 'expense').required().messages({
    'any.only': 'Type must be either "income" or "expense".',
  }),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'Amount must be a positive number.',
  }),
  category: Joi.string()
    .required()
    .when('type', {
      is: 'income',
      then: Joi.valid(...incomeCategories).messages({
        'any.only': `For "income" type, category must be one of: ${incomeCategories.join(', ')}.`,
      }),
      otherwise: Joi.valid(...expenseCategories).messages({
        'any.only': `For "expense" type, category must be one of: ${expenseCategories.join(', ')}.`,
      }),
    }),
  description: Joi.string().allow('').optional(),
  date: Joi.date().optional(),
});
