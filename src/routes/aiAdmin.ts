import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";

import { getAiConfig, memberView } from "../lib/aiAccess.js";
import { asyncHandler, HttpError } from "../lib/http.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { AiMember } from "../models/AiMember.js";
import { AiSettings } from "../models/AiSettings.js";
import { Order } from "../models/Order.js";

export const aiAdminRouter = Router();
aiAdminRouter.use(authenticate, requireAdmin);

const DAY_MS = 24 * 60 * 60 * 1000;

aiAdminRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getAiConfig() });
  }),
);

const settingsSchema = z.object({
  calculatorEnabled: z.coerce.boolean(),
  passName: z.string().trim().min(2, "Give the pass a name."),
  passPrice: z.coerce.number().int("Price must be whole rupees.").min(1, "Price must be at least ₹1."),
  passDays: z.coerce.number().int().min(1, "The pass must last at least a day.").max(3650),
  freeTries: z.coerce.number().int().min(0).max(10, "Ten free tries at most."),
  trialMinutes: z.coerce.number().int().min(1, "A free try must last at least a minute.").max(1440, "A free try can last 24 hours at most."),
  demoOtp: z.string().trim().regex(/^\d{4,8}$/, "The demo code must be 4–8 digits."),
});

aiAdminRouter.put(
  "/settings",
  asyncHandler(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the settings and try again.");
    await AiSettings.findOneAndUpdate({ key: "ai" }, { ...parsed.data, key: "ai" }, { upsert: true });
    res.json({ settings: await getAiConfig() });
  }),
);

/** Every member, newest first, plus the numbers the admin page leads with. */
aiAdminRouter.get(
  "/members",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const filter: Record<string, unknown> = {};
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ phone: rx }, { name: rx }, { email: rx }];
    }
    const now = new Date();
    const [config, docs, total, activePasses, onTrial, revenue] = await Promise.all([
      getAiConfig(),
      AiMember.find(filter).sort({ createdAt: -1 }).limit(500).lean(),
      AiMember.countDocuments({}),
      AiMember.countDocuments({ passExpiresAt: { $gt: now } }),
      AiMember.countDocuments({ trialEndsAt: { $gt: now }, passExpiresAt: { $not: { $gt: now } } }),
      Order.aggregate<{ total: number }>([
        { $match: { kind: "ai_pass", status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);
    res.json({
      summary: { members: total, activePasses, onTrial, revenue: revenue[0]?.total ?? 0 },
      members: docs.map((d) => memberView(d, config)),
    });
  }),
);

async function loadMember(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Member not found.");
  const member = await AiMember.findById(id);
  if (!member) throw new HttpError(404, "Member not found.");
  return member;
}

/** Gives one pass length for free — a promotion, a goodwill gesture, a payment sorted out by hand. */
aiAdminRouter.post(
  "/members/:id/grant",
  asyncHandler(async (req, res) => {
    const member = await loadMember(String(req.params.id));
    const config = await getAiConfig();
    const now = new Date();
    const from = member.passExpiresAt && member.passExpiresAt > now ? member.passExpiresAt : now;
    member.passExpiresAt = new Date(from.getTime() + config.passDays * DAY_MS);
    await member.save();
    res.json({ member: memberView(member.toObject(), config) });
  }),
);

/** Ends their pass and any free try running right now. Paid orders stay in Billing. */
aiAdminRouter.post(
  "/members/:id/revoke",
  asyncHandler(async (req, res) => {
    const member = await loadMember(String(req.params.id));
    member.set({ passExpiresAt: undefined, trialEndsAt: undefined });
    await member.save();
    res.json({ member: memberView(member.toObject(), await getAiConfig()) });
  }),
);

/** Gives their free tries back. */
aiAdminRouter.post(
  "/members/:id/reset-trial",
  asyncHandler(async (req, res) => {
    const member = await loadMember(String(req.params.id));
    member.set({ freeTriesUsed: 0, trialEndsAt: undefined });
    await member.save();
    res.json({ member: memberView(member.toObject(), await getAiConfig()) });
  }),
);
