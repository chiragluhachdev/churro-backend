// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Usernames become the first path segment (/chirag/dashboard), so they must not
 * collide with real routes. Anything here is rejected at signup.
 */
export const RESERVED_USERNAMES = new Set([
  "about", "admin", "api", "blog", "cart", "chef", "chefs", "checkout",
  "contact", "courses", "dashboard", "faqs", "gift-cards", "help", "login",
  "logout", "privacy", "refunds", "reviews", "signup", "success-stories",
  "terms", "careers", "_next", "static", "public", "settings", "account",
]);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 24,
      match: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["student", "admin"], default: "student" },
    avatar: { type: String, default: "" },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: string };

export const User: Model<UserDoc> =
  (models.User as Model<UserDoc>) ?? model<UserDoc>("User", userSchema);

/** Turns a display name into a candidate username: "Chirag Luhach" -> "chirag". */
export function slugifyUsername(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)[0];
  return base.slice(0, 24) || "baker";
}
