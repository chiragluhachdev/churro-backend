import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { asyncHandler, HttpError } from "../lib/http.js";
import { signToken } from "../middleware/auth.js";
import { User } from "../models/User.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function publicUser(user: {
  _id: unknown;
  name: string;
  email: string;
  username: string;
  role: "student" | "admin";
  avatar?: string;
  createdAt?: Date;
}) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    avatar: user.avatar ?? "",
    createdAt: user.createdAt?.toISOString(),
  };
}

/**
 * There is no public registration — the only account is the admin's, created
 * by the seed script. Checkout is guest-only, so students never had one.
 */
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Enter your email and password.");
    const { email, password } = parsed.data;

    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      // Same message either way, so the endpoint cannot be used to discover
      // which email addresses have accounts.
      throw new HttpError(401, "Email or password is incorrect.");
    }

    const payload = { sub: String(user._id), username: user.username, role: user.role };
    res.json({ user: publicUser(user), token: signToken(payload) });
  }),
);
