/** "authorization_url" -> "authorizationUrl". Already camelCase strings come back unchanged. */
export function toCamelCase(value: string): string {
  return value.replace(/[_-]+([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deeply converts object keys to camelCase, e.g. on a Paystack response.
 * Arrays are walked; Dates and other class instances are left as they are.
 */
export function keysToCamelCase<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => keysToCamelCase(item)) as T;
  if (!isPlainObject(value)) return value as T;

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[toCamelCase(key)] = keysToCamelCase(val);
  }
  return result as T;
}
