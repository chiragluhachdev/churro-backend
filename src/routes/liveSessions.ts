import { Router } from "express";
import { z } from "zod";

import { asyncHandler, HttpError } from "../lib/http.js";
import { sendLiveSessionEmail } from "../lib/liveSessionEmail.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { BillingSettings } from "../models/BillingSettings.js";
import { LiveSession } from "../models/LiveSession.js";
import { Order } from "../models/Order.js";

export const liveSessionsRouter = Router();

liveSessionsRouter.use(authenticate, requireAdmin);

function clean(doc: Record<string, unknown>) {
  const { _id, __v, ...rest } = doc as Record<string, unknown> & { _id: unknown };
  void __v;
  return { ...rest, id: String(_id) };
}

/** History of past announcements, newest first. */
liveSessionsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const docs = await LiveSession.find({}).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ sessions: docs.map((d) => clean(d as Record<string, unknown>)) });
  }),
);

const createSchema = z.object({
  title: z.string().trim().min(2, "Give the session a title."),
  description: z.string().trim().default(""),
  link: z.string().trim().url("Enter a valid meeting link."),
  scheduledAt: z.coerce.date({ message: "Pick a date and time." }),
});

/**
 * Creates the announcement and immediately broadcasts it, by email, to
 * every distinct student who has ever paid for a course — one at a time, so
 * each gets a personal "Hi <name>" and nobody sees anyone else's address.
 * Sequential on purpose, to stay well within Brevo's rate limits; this is a
 * small list, not a mailing-list blast.
 */
liveSessionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the details and try again.");
    const { title, description, link, scheduledAt } = parsed.data;

    const students = await Order.aggregate<{ _id: string; name: string }>([
      { $match: { status: "paid" } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$buyerEmail", name: { $first: "$buyerName" } } },
    ]);

    const session = await LiveSession.create({ title, description, link, scheduledAt });

    const settings = await BillingSettings.findOne({ key: "billing" }).lean();
    const seller = {
      companyName: settings?.companyName || "Churro Academy",
      email: settings?.email || "",
      phone: settings?.phone || "",
    };

    let sent = 0;
    let failed = 0;
    for (const student of students) {
      const result = await sendLiveSessionEmail({
        to: student._id,
        name: student.name,
        title,
        description,
        link,
        scheduledAt,
        seller,
      });
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
        console.error(`[live-session] failed to email ${student._id}:`, result.error);
      }
    }

    const updated = await LiveSession.findByIdAndUpdate(
      session._id,
      { sentAt: new Date(), recipientCount: sent, failedCount: failed },
      { new: true },
    ).lean();

    res.status(201).json({ session: clean(updated as Record<string, unknown>) });
  }),
);
