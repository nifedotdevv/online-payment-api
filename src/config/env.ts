function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return value;
}

function optionalHttpUrl(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  try {
    const { protocol } = new URL(raw);
    if (protocol === "http:" || protocol === "https:") return raw;
  } catch {
    // fall through to the error below
  }
  throw new Error(`Environment variable ${name} must be an http(s) URL, got "${raw}"`);
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const env = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: number("PORT", 3000),
  databaseUrl: required("DATABASE_URL"),
  paystackSecretKey: required("PAYSTACK_SECRET_KEY"),
  paystackCallbackUrl: optionalHttpUrl("PAYSTACK_CALLBACK_URL"),
});
