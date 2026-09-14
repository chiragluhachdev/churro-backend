// mongoose ships CJS, so in an ESM package the named exports must come
// off the default export rather than the module namespace.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

/** Generic atomic counter, used to hand out sequential invoice numbers. */
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export type CounterDoc = InferSchemaType<typeof counterSchema>;

export const Counter: Model<CounterDoc> =
  (models.Counter as Model<CounterDoc>) ?? model<CounterDoc>("Counter", counterSchema);

/** Atomically returns the next number in a named sequence, starting at 1. */
export async function nextSeq(key: string): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return doc!.seq;
}
