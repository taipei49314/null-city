import type { z } from "zod";

import { ApiError, NetworkError, ValidationError } from "./errors.js";
import { envelopeSchema } from "./schemas.js";

/** Defensive bound: refuse to even parse a response body larger than this. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface RestTransportOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

/**
 * A request is `"always"` retryable (pure reads — safe no matter how many
 * times they run), `"idempotent-key"` retryable (the request body carries
 * a server-enforced idempotency key, so a retried duplicate is rejected
 * server-side rather than re-executed), or `"never"` retryable (no
 * dedup mechanism exists server-side, so a retry could double-apply the
 * request; the SDK surfaces the failure instead of guessing).
 */
export type Retryability = "always" | "idempotent-key" | "never";

/**
 * Thin, runtime-validated REST client for the public `@null-city/server`
 * HTTP surface. Structurally mirrors `packages/server/src/transport.ts`'s
 * `restClient`, but every response is parsed through a zod schema before
 * any caller sees it, and transient network failures are retried with
 * bounded, jittered backoff according to `Retryability`.
 */
export class RestTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: RestTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 100;
  }

  async call<Schema extends z.ZodTypeAny>(
    method: string,
    path: string,
    schema: Schema,
    options: { body?: unknown; retryable?: Retryability } = {},
  ): Promise<z.infer<Schema>> {
    const retryable = options.retryable ?? "never";
    const attempts = retryable === "never" ? 1 : this.maxRetries + 1;

    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await delay(backoffDelay(this.retryBaseDelayMs, attempt));
      }
      try {
        const raw = await this.sendOnce(method, path, options.body);
        return this.parseEnvelope(raw, schema, path);
      } catch (error) {
        lastError = error;
        if (error instanceof ApiError || error instanceof ValidationError) {
          // Deterministic rejection from a server that received the
          // request; retrying would either repeat the same rejection or
          // (worse) risk double-applying a non-idempotent call. Never retry.
          throw error;
        }
        if (attempt < attempts - 1) {
          continue;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new NetworkError(String(lastError));
  }

  private async sendOnce(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        throw new NetworkError(
          error instanceof Error && error.name === "AbortError"
            ? `request to ${path} timed out after ${this.timeoutMs}ms`
            : `network request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const lengthHeader = response.headers.get("content-length");
      if (lengthHeader !== null && Number(lengthHeader) > MAX_RESPONSE_BYTES) {
        throw new ValidationError(`response from ${path} exceeds the ${MAX_RESPONSE_BYTES}-byte bound`);
      }

      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw new NetworkError(`failed reading response body from ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new ValidationError(`response from ${path} exceeds the ${MAX_RESPONSE_BYTES}-byte bound`);
      }

      if (response.status >= 500) {
        throw new NetworkError(`server error ${response.status} from ${path}`);
      }

      return { status: response.status, text };
    } finally {
      clearTimeout(timer);
    }
  }

  private parseEnvelope<Schema extends z.ZodTypeAny>(
    raw: { status: number; text: string },
    schema: Schema,
    path: string,
  ): z.infer<Schema> {
    let parsed: unknown;
    try {
      parsed = raw.text.length === 0 ? {} : JSON.parse(raw.text);
    } catch {
      throw new ValidationError(`response from ${path} is not valid JSON`);
    }

    const envelope = envelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      throw new ValidationError(`response envelope from ${path} does not match the public contract: ${envelope.error.message}`);
    }

    if (!envelope.data.ok) {
      const error = envelope.data.error ?? { code: "unknown_error", message: `request to ${path} failed` };
      throw new ApiError(error.code, error.message);
    }

    const result = schema.safeParse(envelope.data.result);
    if (!result.success) {
      throw new ValidationError(`result from ${path} does not match the expected public shape: ${result.error.message}`);
    }
    return result.data;
  }
}

function backoffDelay(baseMs: number, attempt: number): number {
  const exponential = baseMs * 2 ** (attempt - 1);
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, 5_000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
