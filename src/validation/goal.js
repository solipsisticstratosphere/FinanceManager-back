import Joi from 'joi';

export const goalValidationSchema = Joi.object({
  title: Joi.string().required(),
  targetAmount: Joi.number().positive().required(),
  deadline: Joi.date().greater('now').required(),
  isActive: Joi.boolean().default(false),
});
