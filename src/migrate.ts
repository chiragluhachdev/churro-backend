/**
 * One-off, idempotent data migrations. Safe to run any number of times, on
 * any environment — each step checks what it needs before touching anything.
 *
 *   npm run migrate
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

import { connectDB } from "./lib/db.js";
import { BillingSettings } from "./models/BillingSettings.js";
import { Course } from "./models/Course.js";

/** Readable and deterministic, so a fresh seed produces the same ids. */
export const lessonKey = (slug: string, s: number, l: number) => `${slug}-s${s + 1}-l${l + 1}`;
export const sectionKey = (slug: string, s: number) => `${slug}-s${s + 1}`;

const migrations = () => mongoose.connection.collection<{ _id: string; appliedAt: Date }>("migrations");
async function once(id: string, run: () => Promise<string>) {
  if (await migrations().findOne({ _id: id })) {
    console.log(`[migrate] ${id}: already applied`);
    return;
  }
  console.log(`[migrate] ${await run()}`);
  await migrations().insertOne({ _id: id, appliedAt: new Date() });
}

async function main() {
  await connectDB();

  let coursesChanged = 0;
  for (const course of await Course.find({})) {
    let changed = false;
    course.curriculum.forEach((section, s) => {
      if (!section.id) { section.id = sectionKey(course.slug, s); changed = true; }
      section.lessons.forEach((lesson, l) => {
        if (!lesson.id) { lesson.id = lessonKey(course.slug, s, l); changed = true; }
      });
    });
    const count = course.curriculum.reduce((n, m) => n + m.lessons.length, 0);
    if (course.lessons !== count) { course.lessons = count; changed = true; }
    if (changed) { course.markModified("curriculum"); await course.save(); coursesChanged++; }
  }
  console.log(`[migrate] courses updated: ${coursesChanged}`);

  // Spelling: the seeded FAQ said "enrol". Only touches that exact, untouched text.
  const OLD = "Lifetime access. Once you enrol, the course is yours to revisit whenever you like — no expiry.";
  const NEW = "Lifetime access. Once you enroll, the course is yours to revisit whenever you like — no expiry.";
  const spelling = await Course.updateMany(
    { "faqs.answer": OLD },
    { $set: { "faqs.$[f].answer": NEW } },
    { arrayFilters: [{ "f.answer": OLD }] },
  );
  console.log(`[migrate] FAQ spelling fixed on courses: ${spelling.modifiedCount}`);

  await once("2026-09-backfill-faqs-requirements", async () => {
    const seedPath = fileURLToPath(new URL("./data/courses.seed.json", import.meta.url));
    const seed = JSON.parse(await readFile(seedPath, "utf8")) as {
      slug: string;
      faqs?: { question: string; answer: string }[];
      requirements?: string[];
    }[];
    let filled = 0;
    for (const item of seed) {
      const course = await Course.findOne({ slug: item.slug });
      if (!course) continue;
      let changed = false;
      if (item.faqs?.length && course.faqs.length === 0) {
        course.set("faqs", item.faqs);
        changed = true;
      }
      if (item.requirements?.length && (course.get("requirements") ?? []).length === 0) {
        course.set("requirements", item.requirements);
        changed = true;
      }
      if (changed) { await course.save(); filled++; }
    }
    return `FAQ/requirements backfilled on courses: ${filled}`;
  });

  // 2026-09: the student dashboard and video player were removed — the chef
  // now sends course material by hand over WhatsApp, and Order is the sole
  // record of a purchase. Any pre-existing Enrollment data was folded into
  // Order (backfilling one where a purchase predated Order entirely) and the
  // collection dropped as a one-off, run against the dev database directly
  // while both models still existed; nothing left for a fresh environment to
  // do here.

  await once("2026-09-strip-lesson-video-fields", async () => {
    // The curriculum editor no longer has video/preview/notes — those old
    // fields are just dead weight now (Mongoose reads .lean() straight off
    // the stored document, schema or no), so rebuild every lesson down to
    // just {id, title, duration}.
    type LegacyLesson = { id: string; title: string; duration: number };
    const docs = await Course.find({}).select("curriculum").lean();
    let touched = 0;
    for (const doc of docs) {
      const curriculum = (doc.curriculum ?? []) as { id: string; title: string; lessons: LegacyLesson[] }[];
      const clean = curriculum.map((section) => ({
        id: section.id,
        title: section.title,
        lessons: section.lessons.map((l) => ({ id: l.id, title: l.title, duration: l.duration })),
      }));
      await Course.updateOne({ _id: doc._id }, { $set: { curriculum: clean } });
      touched++;
    }
    return `legacy lesson fields stripped on courses: ${touched}`;
  });

  await once("2026-09-seed-billing-settings", async () => {
    const result = await BillingSettings.updateOne(
      { key: "billing" },
      {
        $setOnInsert: {
          key: "billing",
          companyName: "Churro Academy",
          gstin: "06CXJPK4427M1Z3",
          gstRate: 18,
        },
      },
      { upsert: true },
    );
    return `billing settings ${result.upsertedCount ? "created" : "already present"}`;
  });

  await mongoose.disconnect();
  console.log("[migrate] done");
}

// Only run when executed directly, not when imported for the key helpers.
if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) {
  main().catch((error) => {
    console.error("[migrate] failed", error);
    process.exit(1);
  });
}
