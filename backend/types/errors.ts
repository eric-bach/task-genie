export class InvalidWorkItemError extends Error {
  public error: string;
  public code: number;

  constructor(error: string, message: string, code: number) {
    super(message);
    this.error = error;
    this.name = 'InvalidWorkItem';
    this.code = code;

    Error.captureStackTrace?.(this, this.constructor);
  }
}
