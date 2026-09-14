import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../lib/env.js";
import { HttpError } from "../lib/http.js";

export interface AuthPayload {
  sub: string;
  username: string;
  role: "student" | "admin";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);
}

/** Reads `Authorization: Bearer <token>` and attaches the payload. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.slice(7), env.jwtSecret) as AuthPayload;
    } catch {
      // An invalid or expired token is treated as anonymous; routes that need
      // a user will reject below with a clear 401.
    }
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Sign in to continue."));
  if (req.user.role !== "admin") return next(new HttpError(403, "Admins only."));
  next();
}
