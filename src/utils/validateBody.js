export const validateBody = (schema) => async (req, res, next) => {
  console.log(req.body);
  try {
    await schema.validateAsync(req.body, { abortEarly: false });
    next();
  } catch (error) {
    console.log(error);
    const errors = error.details?.reduce((acc, detail) => {
      const key = detail.path[0];
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(detail.message);
      return acc;
    }, {});

    const errorResponse = {
      status: 400,
      message: 'BadRequestError',
      data: {
        message: 'Bad request',
        errors,
      },
    };
    res.status(400).json(errorResponse);
  }
};
export default validateBody;
