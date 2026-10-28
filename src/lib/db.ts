import mongoose from "mongoose";

import { env } from "./env.js";

export async function connectDB(): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri);
  console.log(`[db] connected to ${mongoose.connection.name}`);
  await dropLegacyIndexes();
}

/**
 * Churro AI sign-in moved from phone to email. The old unique phone indexes
 * would reject a second member (or code) with no phone, so they go. Missing
 * ones are fine — this is a no-op after the first deploy.
 */
async function dropLegacyIndexes(): Promise<void> {
  for (const name of ["aimembers", "aiotps"]) {
    const collection = mongoose.connection.collection(name);
    if (await collection.indexExists("phone_1").catch(() => false)) {
      await collection.dropIndex("phone_1");
      console.log(`[db] dropped legacy ${name}.phone_1 index`);
    }
  }
}
