import { AiSettings } from "../models/AiSettings.js";

export interface AiConfig {
  calculatorEnabled: boolean;
  passName: string;
  passPrice: number;
  passDays: number;
  freeTries: number;
  trialMinutes: number;
  demoOtp: string;
}

const DEFAULTS: AiConfig = {
  calculatorEnabled: false,
  passName: "Churro AI Pass",
  passPrice: 999,
  passDays: 365,
  freeTries: 1,
  trialMinutes: 60,
  demoOtp: "123456",
};

export async function getAiConfig(): Promise<AiConfig> {
  const doc = await AiSettings.findOne({ key: "ai" }).lean();
  return {
    calculatorEnabled: doc?.calculatorEnabled ?? DEFAULTS.calculatorEnabled,
    passName: doc?.passName || DEFAULTS.passName,
    passPrice: doc?.passPrice ?? DEFAULTS.passPrice,
    passDays: doc?.passDays ?? DEFAULTS.passDays,
    freeTries: doc?.freeTries ?? DEFAULTS.freeTries,
    trialMinutes: doc?.trialMinutes ?? DEFAULTS.trialMinutes,
    demoOtp: doc?.demoOtp || DEFAULTS.demoOtp,
  };
}

/** "+91 98765-43210", "098765 43210", "9876543210" → "9876543210", or null if it isn't an Indian mobile. */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export type AiAccess = "pass" | "trial" | "trial_available" | "locked";

interface MemberLike {
  _id: unknown;
  phone: string;
  name?: string | null;
  email?: string | null;
  freeTriesUsed?: number | null;
  trialEndsAt?: Date | null;
  passExpiresAt?: Date | null;
  lastLoginAt?: Date | null;
  createdAt?: Date | null;
}

/** The one place that decides what a member can do right now. */
export function accessFor(member: MemberLike, config: AiConfig, now = new Date()): AiAccess {
  if (member.passExpiresAt && member.passExpiresAt > now) return "pass";
  if (member.trialEndsAt && member.trialEndsAt > now) return "trial";
  if ((member.freeTriesUsed ?? 0) < config.freeTries) return "trial_available";
  return "locked";
}

const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : undefined);

export function memberView(member: MemberLike, config: AiConfig) {
  return {
    id: String(member._id),
    phone: member.phone,
    name: member.name ?? "",
    email: member.email ?? "",
    access: accessFor(member, config),
    freeTriesUsed: member.freeTriesUsed ?? 0,
    freeTriesLeft: Math.max(0, config.freeTries - (member.freeTriesUsed ?? 0)),
    trialEndsAt: iso(member.trialEndsAt),
    passExpiresAt: iso(member.passExpiresAt),
    lastLoginAt: iso(member.lastLoginAt),
    joinedAt: iso(member.createdAt),
  };
}
