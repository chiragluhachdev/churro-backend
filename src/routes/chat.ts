import { Router } from "express";
import { z } from "zod";

import { asyncHandler, HttpError } from "../lib/http.js";
import { Course } from "../models/Course.js";

export const chatRouter = Router();

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});

/** Facts the bot is allowed to state. Everything else it defers to WhatsApp. */
const POLICIES = [
  { keys: ["refund", "money back", "cancel"], answer: "Courses come with a 7-day refund window — if it isn't for you, email hello@churroacademy.com within a week of buying and we'll refund in full." },
  { keys: ["access", "expire", "how long", "lifetime"], answer: "Access is for life. Buy a course once and it stays in your dashboard permanently, including any future updates to it." },
  { keys: ["certificate", "certification"], answer: "Yes — finish every lesson in a course and a certificate is issued automatically. You'll find it under Certificates in your dashboard." },
  { keys: ["beginner", "new to baking", "never baked", "experience"], answer: "Plenty of our courses are built for complete beginners — Cookie Craft, Churros From Scratch and Chocolate Cake Mastery all start from scratch and assume no experience." },
  { keys: ["equipment", "tools", "oven", "need to buy"], answer: "Nothing specialist. A home oven, basic bowls and a hand mixer will carry you through most courses. Anything extra is listed on the course page before you buy." },
  { keys: ["pay", "payment", "card", "upi", "razorpay"], answer: "You can pay by card or UPI at checkout. Payment is processed securely and your course unlocks straight away." },
  { keys: ["teacher", "instructor", "who teaches", "chef"], answer: "Every course is written, tested and filmed by Chef Simone Kathuria, who founded Churro Academy." },
  { keys: ["contact", "support", "help", "email", "phone"], answer: "You can reach us at hello@churroacademy.com, or tap the WhatsApp button below for a faster reply." },
];

const GREETINGS = ["hi", "hello", "hey", "hola", "namaste", "good morning", "good evening"];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

async function courseContext(): Promise<string> {
  const courses = await Course.find({ published: true })
    .select("title slug price discountPrice level lessons duration category shortDescription")
    .lean();

  return courses
    .map(
      (c) =>
        `- ${c.title} (${c.category}, ${c.level}): ₹${c.discountPrice ?? c.price}, ${c.lessons} lessons, ${c.duration}. ${c.shortDescription}`,
    )
    .join("\n");
}

/** Keyword fallback — grounded in the same live catalogue, no model required. */
async function localAnswer(question: string): Promise<string> {
  const q = question.toLowerCase();

  if (GREETINGS.some((g) => q === g || q.startsWith(`${g} `) || q.startsWith(`${g},`))) {
    return "Hi! I can help with courses, pricing, refunds and how the academy works. What would you like to know?";
  }

  for (const policy of POLICIES) {
    if (policy.keys.some((key) => q.includes(key))) return policy.answer;
  }

  const courses = await Course.find({ published: true })
    .select("title slug price discountPrice level lessons duration category")
    .lean();

  // Name-matched course question.
  const hit = courses.find((c) => {
    const words = String(c.title).toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    return words.some((w) => q.includes(w));
  });
  if (hit) {
    return `${hit.title} is ₹${hit.discountPrice ?? hit.price} — ${hit.lessons} lessons, ${hit.duration}, pitched at ${String(hit.level).toLowerCase()} level. You get lifetime access and a certificate at the end. Want the link?`;
  }

  if (q.includes("price") || q.includes("cost") || q.includes("how much") || q.includes("fee")) {
    const prices = courses.map((c) => Number(c.discountPrice ?? c.price));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return `Courses run from ₹${min} to ₹${max}, bought individually with lifetime access — there's no subscription. Which one were you looking at?`;
  }

  if (q.includes("course") || q.includes("what do you") || q.includes("list") || q.includes("teach")) {
    return `We have ${courses.length} courses across cakes, French pastry, breads and fried sweets — including ${courses
      .slice(0, 3)
      .map((c) => c.title)
      .join(", ")}. Anything specific you're after?`;
  }

  return "I'm not sure about that one. Tap the WhatsApp button below and Chef Simone's team will get straight back to you.";
}

/**
 * Calls Groq's OpenAI-compatible endpoint with an open-weight Llama model.
 * Only used when GROQ_API_KEY is configured; otherwise the keyword matcher runs.
 */
async function llmAnswer(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("no key");

  const system = `You are the assistant for Churro Academy, an online baking school founded by Chef Simone Kathuria.

Answer only from the facts below. If you cannot answer from them, say you're not sure and suggest tapping the WhatsApp button. Never invent prices, policies or courses.

Courses currently on sale:
${await courseContext()}

Policies:
- Lifetime access to any course you buy. No subscription.
- Certificate issued automatically when every lesson is finished.
- 7-day refund window.
- Every course is taught by Chef Simone Kathuria.
- Prices are in Indian rupees.

Answering well:
- Asked about price generally, quote the range across all courses and name the cheapest. Don't ask which course first.
- Asked for a recommendation, name two or three specific courses with their price and level.
- Asked to compare courses, give the price, lesson count and level of each.
- Only ask a clarifying question if the request is genuinely ambiguous.

Keep replies under 60 words, warm and plain. No markdown, no bullet lists.`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
      temperature: 0.3,
      // gpt-oss spends part of its budget on internal reasoning, so the cap has
      // to cover that as well as the visible reply or answers arrive truncated
      // — or empty, which used to silently drop us back to keyword matching.
      max_completion_tokens: 900,
      reasoning_effort: "low",
      messages: [{ role: "system", content: system }, ...messages],
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) throw new Error(`groq ${response.status}`);
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty completion");
  // Strip any markdown the model reaches for despite being asked not to.
  return text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
}

chatRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Say something first.");

    const { messages } = parsed.data;
    const last = messages[messages.length - 1];
    if (last.role !== "user") throw new HttpError(400, "Expected a question.");

    // Try the model; fall back to keyword matching so the widget always answers.
    let reply: string;
    let source: "llm" | "local" = "llm";
    try {
      reply = await llmAnswer(messages);
    } catch {
      source = "local";
      reply = await localAnswer(last.content);
    }

    res.json({ reply, source });
  }),
);
