import mongoose from "mongoose";
import { HttpError } from "../utils/http-error.js";

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Something went wrong. Please try again.";
  let details;

  if (error instanceof HttpError) {
    ({ status, code, message } = error);
  } else if (error instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Please check the information you entered.";
    details = Object.values(error.errors).map((item) => ({
      field: item.path,
      message:
        item instanceof mongoose.Error.CastError
          ? "Enter a valid value."
          : item.message,
    }));
  } else if (error instanceof mongoose.Error.CastError) {
    status = 400;
    code = "INVALID_VALUE";
    message = "The requested value is invalid.";
  } else if (error.code === 11000) {
    status = 409;
    code = "DUPLICATE_RECORD";
    message = "This record already exists.";
  } else if (error.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "The request must contain valid JSON.";
  } else if (error.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "The request is too large.";
  } else if (
    [
      "MongoServerSelectionError",
      "MongooseServerSelectionError",
      "MongoNetworkError",
      "MongoNotConnectedError",
    ].includes(error.name)
  ) {
    status = 503;
    code = "DATABASE_UNAVAILABLE";
    message =
      "The service is temporarily unavailable. Please try again shortly.";
  }

  res
    .status(status)
    .json({ ok: false, error: { code, message, ...(details && { details }) } });
}
