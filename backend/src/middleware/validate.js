// Wraps a Joi schema into Express middleware. Usage: validate(registerSchema)
// as a route handler arg — it either calls next() with a clean, validated
// req.body, or forwards a 400 to the error handler with Joi's message.
export function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // collect all validation errors, not just the first
      stripUnknown: true, // drop fields not defined in the schema
    });

    if (error) {
      const message = error.details.map((d) => d.message).join(", ");
      const validationError = new Error(message);
      validationError.statusCode = 400;
      return next(validationError);
    }

    req.body = value;
    next();
  };
}
