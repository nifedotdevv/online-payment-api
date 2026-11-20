import { ApiError } from "../utils/ApiError";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface BaseApiConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Small fetch wrapper for calling external HTTP APIs.
 * Extend it per service (see PaystackApi) and call the protected helpers.
 */
export abstract class BaseApi {
  protected readonly baseUrl: string;
  protected readonly defaultHeaders: Record<string, string>;
  protected readonly timeoutMs: number;

  constructor({ baseUrl, headers = {}, timeoutMs = 10_000 }: BaseApiConfig) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.defaultHeaders = { Accept: "application/json", ...headers };
    this.timeoutMs = timeoutMs;
  }

  protected get<T>(path: string, options?: Omit<RequestOptions, "body">) {
    return this.request<T>("GET", path, options);
  }

  protected post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>("POST", path, { ...options, body });
  }

  protected put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>("PUT", path, { ...options, body });
  }

  protected patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  protected delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>("DELETE", path, options);
  }

  protected async request<T>(
    method: HttpMethod,
    path: string,
    { query, body, headers, timeoutMs }: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...this.defaultHeaders,
          ...(body !== undefined && { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      // Log the URL without the query string, which could hold sensitive values.
      console.error(`${method} ${url.origin}${url.pathname} failed:`, err);
      throw ApiError.badGateway(
        timedOut ? "Upstream request timed out" : "Upstream request failed",
      );
    }

    const text = await response.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      // Log only the status and message: full error bodies can contain customer details.
      const message =
        typeof data === "object" && data !== null && "message" in data
          ? (data as { message: unknown }).message
          : undefined;
      console.error(`${method} ${url.origin}${url.pathname} -> ${response.status}`, message ?? "");
      throw this.toApiError(response.status, data);
    }

    return data as T;
  }

  /** Override to map a service's error responses to ApiErrors. */
  protected toApiError(status: number, _data: unknown): ApiError {
    return ApiError.badGateway(`Upstream service responded with ${status}`);
  }
}
