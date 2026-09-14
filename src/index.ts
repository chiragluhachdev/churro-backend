import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";

import { connectDB } from "./lib/db.js";
import { activeEmailProvider } from "./lib/email.js";
import { env } from "./lib/env.js";
import { HttpError } from "./lib/http.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { adminContentRouter, contentRouter } from "./routes/content.js";
import { coursesRouter } from "./routes/courses.js";
import { ordersRouter } from "./routes/orders.js";
import { uploadRouter } from "./routes/upload.js";

const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "churro-academy-api",
    // Whether the chat model is configured — reports presence only, never the key.
    chatModel: process.env.GROQ_API_KEY
      ? (process.env.GROQ_MODEL ?? "openai/gpt-oss-20b")
      : null,
    // "dummy" just logs the email instead of sending it — set BREVO_API_KEY to go live.
    emailProvider: activeEmailProvider(),
  });
});

app.use("/api/auth", authRouter);
app.use("/api/chat", chatRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/content", contentRouter);
app.use("/api/admin/content", adminContentRouter);
app.use("/api/admin", adminRouter);
app.use("/api/upload", uploadRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found." });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }
  // Duplicate key from a unique index — surface it as a conflict, not a 500.
  if (typeof error === "object" && error && (error as { code?: number }).code === 11000) {
    return res.status(409).json({ error: "That already exists." });
  }
  console.error("[error]", error);
  res.status(500).json({ error: "Something went wrong." });
});

async function start() {
  await connectDB();
  app.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
