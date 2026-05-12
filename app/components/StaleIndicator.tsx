"use client";

export function StaleIndicator({ staleSince }: { staleSince: number | null }) {
  if (staleSince === null) return null;
  return (
    <div className="stale-indicator" role="status">
      🔴 disconnected — reconnecting…
    </div>
  );
}
