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
    await Promise.all([Course.deleteMany({}), Enrollment.deleteMany({})]);
    console.log("[seed] cleared courses + enrollments");
  }

  const seedPath = fileURLToPath(new URL("./data/courses.seed.json", import.meta.url));
  const courses = JSON.parse(await readFile(seedPath, "utf8")) as ({ slug: string } & Record<string, unknown>)[];

  for (const course of courses) {
    await Course.updateOne(
      { slug: course.slug },
      { $set: { ...course, published: true } },
      { upsert: true },
    );
  }
  console.log(`[seed] upserted ${courses.length} courses`);

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

  await mongoose.disconnect();
  console.log("[seed] done");
}

main().catch((error) => {
  console.error("[seed] failed", error);
  process.exit(1);
});
