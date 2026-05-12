// Shared helpers for API route handlers.

import { NextResponse } from "next/server";

import { DomainError, type DomainErrorCode } from "../state";

const STATUS_BY_CODE: Record<DomainErrorCode | "internal-error", number> = {
  "invalid-phase": 409,
  "invalid-config": 400,
  "invalid-order": 400,
  "mqtt-not-connected": 409,
  "nothing-to-undo": 409,
  "unknown-player": 404,
  "unknown-device": 404,
  "device-in-use": 409,
  "bad-request": 400,
  "internal-error": 500,
};

export type ApiError = {
  error: { code: string; message: string; details?: unknown };
};

export function ok<T>(data: T, init?: ResponseInit): NextResponse<{ data: T }> {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T): NextResponse<{ data: T }> {
  return ok(data, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function errorResponse(
  code: DomainErrorCode | "internal-error",
  message: string,
  details?: unknown,
): NextResponse<ApiError> {
  const status = STATUS_BY_CODE[code];
  const body: ApiError =
    details === undefined
      ? { error: { code, message } }
      : { error: { code, message, details } };
  return NextResponse.json(body, { status });
}

export function handleError(err: unknown): NextResponse<ApiError> {
  if (err instanceof DomainError) {
    return errorResponse(err.code, err.message, err.details);
  }
  const msg = err instanceof Error ? err.message : "Unexpected error";
  return errorResponse("internal-error", msg);
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError("bad-request", "Request body is not valid JSON");
  }
}

export function badRequest(message: string, details?: unknown): NextResponse<ApiError> {
  return errorResponse("bad-request", message, details);
}
