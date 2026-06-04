// A lightweight error carrying an HTTP status, thrown by extracted service
// functions (createTaskService, createFindingService, reassignTaskService, …).
// The HTTP handler and the escalation action endpoint both translate it into a
// `res.status(err.status).json({ message })`; anything else maps to a 500.
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}
