/**
 * One-off, idempotent data migration for the lesson/progress upgrade.
 *
 *   npm run migrate
 *
 * Safe to run any number of times, on any environment:
 *  1. Every section and lesson gets a stable id (existing ids are kept), and the
 *     course's lesson count is set from its real curriculum.
 *  2. Old numeric progress ("7 lessons done") becomes the ids of the first N
 *     lessons, so students keep their progress.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

import { lessonIdsOf } from "./lib/curriculum.js";
import { connectDB } from "./lib/db.js";
import { Course } from "./models/Course.js";
import { Enrollment } from "./models/Enrollment.js";
import { User } from "./models/User.js";

/** Readable and deterministic, so a fresh seed produces the same ids. */
export const lessonKey = (slug: string, s: number, l: number) => `${slug}-s${s + 1}-l${l + 1}`;
export const sectionKey = (slug: string, s: number) => `${slug}-s${s + 1}`;

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
    const count = lessonIdsOf(course);
    if (course.lessons !== count.length) { course.lessons = count.length; changed = true; }
    if (changed) { course.markModified("curriculum"); await course.save(); coursesChanged++; }
  }
  console.log(`[migrate] courses updated: ${coursesChanged}`);

  let progressMigrated = 0;
  const legacy = await Enrollment.find({
    completedLessons: { $gt: 0 },
    $or: [{ completedLessonIds: { $exists: false } }, { completedLessonIds: { $size: 0 } }],
  }).populate("course");
  for (const enrollment of legacy) {
    const course = enrollment.course as unknown as { curriculum?: { lessons?: { id?: string }[] }[] } | null;
    if (!course) continue;
    const ids = lessonIdsOf(course);
    enrollment.completedLessonIds = ids.slice(0, Math.min(enrollment.completedLessons, ids.length));
    enrollment.completedLessons = enrollment.completedLessonIds.length;
    if (ids.length > 0 && enrollment.completedLessons >= ids.length) enrollment.completedAt ??= new Date();
    else enrollment.completedAt = undefined;
    await enrollment.save();
    progressMigrated++;
  }
  console.log(`[migrate] enrollments converted to per-lesson progress: ${progressMigrated}`);

  // 3. Admin accounts can no longer buy courses. Remove enrollments an admin
  //    created before that rule existed (they were test clicks, not sales).
  const adminIds = (await User.find({ role: "admin" }).select("_id email")).map((u) => u._id);
  const adminOwned = await Enrollment.find({ user: { $in: adminIds } }).populate("user", "email").populate("course", "title");
  for (const e of adminOwned) {
    const who = (e.user as unknown as { email?: string })?.email;
    const what = (e.course as unknown as { title?: string })?.title;
    console.log(`[migrate]   removing admin-owned enrollment: ${who} -> ${what} (₹${e.amountPaid})`);
  }
  const removed = await Enrollment.deleteMany({ user: { $in: adminIds } });
  console.log(`[migrate] admin-owned enrollments removed: ${removed.deletedCount}`);

  // 4. Spelling: the seeded FAQ said "enrol". Only touches that exact, untouched text.
  const OLD = "Lifetime access. Once you enrol, the course is yours to revisit whenever you like — no expiry.";
  const NEW = "Lifetime access. Once you enroll, the course is yours to revisit whenever you like — no expiry.";
  const spelling = await Course.updateMany(
    { "faqs.answer": OLD },
    { $set: { "faqs.$[f].answer": NEW } },
    { arrayFilters: [{ "f.answer": OLD }] },
  );
  console.log(`[migrate] FAQ spelling fixed on courses: ${spelling.modifiedCount}`);

  // 5. FAQs and requirements existed in the original site content but the
  //    database had nowhere to keep them. Copy them in once, only into courses
  //    whose lists are still empty. Recorded so a later run never re-adds
  //    something the admin deliberately removed.
  const migrations = mongoose.connection.collection<{ _id: string; appliedAt: Date }>("migrations");
  const BACKFILL = "2026-09-backfill-faqs-requirements";
  if (await migrations.findOne({ _id: BACKFILL })) {
    console.log("[migrate] FAQ/requirements backfill: already applied");
  } else {
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
    await migrations.insertOne({ _id: BACKFILL, appliedAt: new Date() });
    console.log(`[migrate] FAQ/requirements backfilled on courses: ${filled}`);
  }

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
