import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { asyncHandler, HttpError } from "../lib/http.js";
import { authenticate, requireAuth, signToken } from "../middleware/auth.js";
import { RESERVED_USERNAMES, User, slugifyUsername } from "../models/User.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, "Tell us what to call you.").max(60),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/** chirag -> chirag2 -> chirag3 … */
async function uniqueUsername(base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (RESERVED_USERNAMES.has(candidate) || (await User.exists({ username: candidate }))) {
    n += 1;
    candidate = `${base}${n}`;
  }
  return candidate;
}

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

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid details.");
    }
    const { name, email, password } = parsed.data;

    if (await User.exists({ email })) {
      throw new HttpError(409, "An account with that email already exists.");
    }

    const username = await uniqueUsername(slugifyUsername(name));
    const user = await User.create({
      name,
      email,
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: "student",
    });

    const payload = { sub: String(user._id), username: user.username, role: user.role };
    res.status(201).json({ user: publicUser(user), token: signToken(payload) });
  }),
);

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

authRouter.get(
  "/me",
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.sub);
    if (!user) throw new HttpError(404, "Account not found.");
    res.json({ user: publicUser(user) });
  }),
);

const profileSchema = z.object({
  name: z.string().trim().min(2).max(60),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Usernames are at least 3 characters.")
    .max(24)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Letters, numbers and hyphens only."),
});

authRouter.patch(
  "/me",
  authenticate,
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid details.");
    }
    const { name, username } = parsed.data;
    const id = req.user!.sub;

    if (username !== req.user!.username) {
      if (RESERVED_USERNAMES.has(username)) throw new HttpError(409, "That username is reserved.");
      if (await User.exists({ username, _id: { $ne: id } })) {
        throw new HttpError(409, "That username is taken.");
      }
    }

    const user = await User.findByIdAndUpdate(id, { name, username }, { new: true });
    if (!user) throw new HttpError(404, "Account not found.");

    // Username is embedded in the token, so hand back a refreshed one.
    const payload = { sub: String(user._id), username: user.username, role: user.role };
    res.json({ user: publicUser(user), token: signToken(payload) });
  }),
);
