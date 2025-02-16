import Joi from 'joi';

export const monobankTokenSchema = Joi.object({
  token: Joi.string().required().messages({
    'string.empty': 'Токен Монобанка не может быть пустым',
    'any.required': 'Токен Монобанка обязателен',
  }),
});
