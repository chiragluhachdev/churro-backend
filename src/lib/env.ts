function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required("MONGODB_URI"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim()),
  // Where links in outbound emails point back to. CORS_ORIGIN can't stand in
  // for this — it's allowed to be "*" — so this is its own setting.
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
};
