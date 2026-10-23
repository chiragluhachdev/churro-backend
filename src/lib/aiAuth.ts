import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "./env.js";
import { HttpError } from "./http.js";

/**
 * Churro AI members get their own token, separate from the admin's: a
 * different audience, so neither kind of token is ever accepted where the
 * other is expected.
 */
const AUDIENCE = "churroai";

interface MemberPayload {
  sub: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      memberId?: string;
    }
  }
}

export function signMemberToken(memberId: string): string {
  return jwt.sign({ sub: memberId } satisfies MemberPayload, env.jwtSecret, {
    audience: AUDIENCE,
    expiresIn: "30d",
  });
}

export function requireMember(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(new HttpError(401, "Please sign in to Churro AI."));
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret, { audience: AUDIENCE }) as MemberPayload;
    req.memberId = payload.sub;
    next();
  } catch {
    next(new HttpError(401, "Your session has ended. Please sign in again."));
  }
}
