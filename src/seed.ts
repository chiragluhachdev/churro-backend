/**
 * Seeds MongoDB with the starter catalogue and an admin account.
 *
 *   npm run seed             # upsert courses by slug, leave users alone
 *   npm run seed -- --fresh  # wipe courses + enrollments first
 *
 * Safe to re-run.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { connectDB } from "./lib/db.js";
import { Course } from "./models/Course.js";
import { Enrollment } from "./models/Enrollment.js";
import { ChefProfile } from "./models/ChefProfile.js";
import { Post } from "./models/Post.js";
import { Testimonial } from "./models/Testimonial.js";
import { User } from "./models/User.js";

const ADMIN = {
  name: "Chef Simone Kathuria",
  username: "simone",
  email: "admin@churroacademy.com",
  password: "churro-admin",
};

async function main() {
  const fresh = process.argv.includes("--fresh");
  await connectDB();

  if (fresh) {
    await Promise.all([
      Course.deleteMany({}),
      Enrollment.deleteMany({}),
      Testimonial.deleteMany({}),
      Post.deleteMany({}),
      ChefProfile.deleteMany({}),
    ]);
    console.log("[seed] cleared courses, enrollments and site content");
  }

  const seedPath = fileURLToPath(new URL("./data/courses.seed.json", import.meta.url));
  const courses = JSON.parse(await readFile(seedPath, "utf8")) as ({ slug: string } & Record<string, unknown>)[];

  // $setOnInsert, not $set: a re-run must not reset a course the admin has
  // since edited (price, title, published state…) back to these defaults.
  let newCourses = 0;
  for (const course of courses) {
    const result = await Course.updateOne(
      { slug: course.slug },
      { $setOnInsert: { ...course, published: true } },
      { upsert: true },
    );
    newCourses += result.upsertedCount;
  }
  console.log(`[seed] courses: ${newCourses} inserted, ${courses.length - newCourses} already present`);

  const existing = await User.findOne({ email: ADMIN.email });
  if (existing) {
    existing.role = "admin";
    await existing.save();
    console.log(`[seed] admin already present (${ADMIN.email})`);
  } else {
    await User.create({
      name: ADMIN.name,
      username: ADMIN.username,
      email: ADMIN.email,
      passwordHash: await bcrypt.hash(ADMIN.password, 12),
      role: "admin",
    });
    console.log(`[seed] created admin ${ADMIN.email} / ${ADMIN.password}`);
  }

  const STUDENT = {
    name: "Alex Student",
    username: "alex",
    email: "alex@example.com",
    password: "password123",
  };

  const existingStudent = await User.findOne({ email: STUDENT.email });
  if (!existingStudent) {
    await User.create({
      name: STUDENT.name,
      username: STUDENT.username,
      email: STUDENT.email,
      passwordHash: await bcrypt.hash(STUDENT.password, 12),
      role: "student",
    });
    console.log(`[seed] created student ${STUDENT.email} / ${STUDENT.password}`);
  } else {
    console.log(`[seed] student already present (${STUDENT.email})`);
  }


  // ---- Site content -------------------------------------------------------
  // $setOnInsert only: once content exists, re-running the seed must never
  // overwrite what an admin has since edited.
  const readSeed = async (name: string) =>
    JSON.parse(await readFile(fileURLToPath(new URL(`./data/${name}`, import.meta.url)), "utf8"));

  const testimonials = (await readSeed("testimonials.seed.json")) as Record<string, unknown>[];
  if ((await Testimonial.countDocuments({})) === 0) {
    await Testimonial.insertMany(testimonials);
    console.log(`[seed] inserted ${testimonials.length} testimonials`);
  } else {
    console.log("[seed] testimonials already present — left untouched");
  }

  const posts = (await readSeed("posts.seed.json")) as ({ slug: string } & Record<string, unknown>)[];
  let newPosts = 0;
  for (const post of posts) {
    const result = await Post.updateOne({ slug: post.slug }, { $setOnInsert: post }, { upsert: true });
    newPosts += result.upsertedCount;
  }
  console.log(`[seed] posts: ${newPosts} inserted, ${posts.length - newPosts} already present`);

  const chef = (await readSeed("chef.seed.json")) as Record<string, unknown>;
  const chefResult = await ChefProfile.updateOne(
    { key: "chef" },
    { $setOnInsert: { ...chef, key: "chef" } },
    { upsert: true },
  );
  console.log(`[seed] chef profile ${chefResult.upsertedCount ? "created" : "already present — left untouched"}`);

  await mongoose.disconnect();
  console.log("[seed] done");
}

main().catch((error) => {
  console.error("[seed] failed", error);
  process.exit(1);
});
