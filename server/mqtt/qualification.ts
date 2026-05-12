// Payload qualification per specs/07-mqtt-integration.md §"Payload schema and qualification".

export function qualifies(
  payload: Buffer,
  acceptedActions: string[] | undefined,
): boolean {
  if (payload.length === 0) return false;
  const text = payload.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Plain-text payload.
    if (acceptedActions === undefined) return true;
    return acceptedActions.includes(text);
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const action = (parsed as { action?: unknown }).action;
    if (typeof action === "string") {
      if (acceptedActions === undefined) return true;
      return acceptedActions.includes(action);
    }
    // JSON object without `action` field: qualifies iff acceptedActions undefined.
    return acceptedActions === undefined;
  }
  // JSON of some other kind (number, array, null, bool): qualifies iff
  // acceptedActions is undefined (spec implies any "non-empty" qualifies).
  return acceptedActions === undefined;
}
