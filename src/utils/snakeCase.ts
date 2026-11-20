/**
 * "callbackUrl" -> "callback_url", "HTTPStatus" -> "http_status", "first-name" -> "first_name".
 * Already snake_case strings come back unchanged.
 */
export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deeply converts object keys to snake_case, e.g. before sending a body to Paystack.
 * Arrays are walked; Dates and other class instances are left as they are.
 */
export function keysToSnakeCase<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => keysToSnakeCase(item)) as T;
  if (!isPlainObject(value)) return value as T;

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[toSnakeCase(key)] = keysToSnakeCase(val);
  }
  return result as T;
}
