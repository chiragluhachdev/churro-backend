import type { NextFunction, Request, Response } from "express";

/** Error with an HTTP status attached, thrown from routes. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Keeps only the keys the client actually sent.
 *
 * Zod applies `.default()` values even under `.partial()`, so parsing a PATCH
 * body of `{ price: 1 }` yields `{ price: 1, description: "", featured: false }`
 * — and writing that back silently erases every defaulted field. Every PATCH
 * must pass its parsed data through here before it touches the database.
 */
export function onlySentFields<T extends Record<string, unknown>>(
  parsed: T,
  body: unknown,
): Partial<T> {
  const sent = body && typeof body === "object" ? Object.keys(body) : [];
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => sent.includes(key)),
  ) as Partial<T>;
}
