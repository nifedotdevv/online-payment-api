export type Result<T, E = Error> = [error: null, data: T] | [error: E, data: null];

/**
 * Awaits a promise (or async function) and returns [error, data] instead of throwing.
 * Use it when you want to handle a failure inline rather than let it reach errorHandler.
 *
 *   const [err, res] = await attempt(paystackApi.initialisePayment(details));
 *   if (err) { ... }
 *
 * Route handlers don't need this: Express 5 already forwards async errors to errorHandler.
 */
export async function attempt<T, E = Error>(
  input: Promise<T> | (() => Promise<T>),
): Promise<Result<T, E>> {
  try {
    const data = await (typeof input === "function" ? input() : input);
    return [null, data];
  } catch (error) {
    return [error as E, null];
  }
}
