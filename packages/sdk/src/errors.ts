/**
 * SDK error taxonomy. Every error the SDK throws is one of these, so
 * callers can branch on `code` without inspecting the message text.
 */
export class SdkError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SdkError";
    this.code = code;
  }
}

/** The request could not reach the server, or the server did not respond. */
export class NetworkError extends SdkError {
  constructor(message: string) {
    super("network_error", message);
    this.name = "NetworkError";
  }
}

/**
 * The server responded, but the response body did not match the expected
 * public-contract shape (missing fields, wrong types, or oversized). The
 * SDK never hands an unvalidated payload to caller code.
 */
export class ValidationError extends SdkError {
  constructor(message: string) {
    super("invalid_response", message);
    this.name = "ValidationError";
  }
}

/** The server returned a well-formed `{ ok: false, error }` envelope. */
export class ApiError extends SdkError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ApiError";
  }
}
