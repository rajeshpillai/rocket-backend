export interface ErrorDetail {
  field?: string;
  rule?: string;
  message: string;
}

export class AppError extends Error {
  code: string;
  status: number;
  details?: ErrorDetail[];

  constructor(
    code: string,
    status: number,
    message: string,
    details?: ErrorDetail[],
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function notFoundError(entity: string, id: string): AppError {
  return new AppError(
    "NOT_FOUND",
    404,
    `${entity} with id ${id} not found`,
  );
}

export function unknownEntityError(name: string): AppError {
  return new AppError("UNKNOWN_ENTITY", 404, `Unknown entity: ${name}`);
}

export function conflictError(msg: string): AppError {
  return new AppError("CONFLICT", 409, msg);
}

export function validationError(details: ErrorDetail[]): AppError {
  return new AppError("VALIDATION_FAILED", 422, "Validation failed", details);
}
