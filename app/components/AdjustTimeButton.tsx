"use client";

import { useState } from "react";

import { api } from "@/client/api";
import type { Id } from "@/shared/types";

export function AdjustTimeButton({ playerId, label }: { playerId: Id; label?: string }) {
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState(30);
  const apply = async (sign: 1 | -1) => {
    try {
      await api.adjustTime(playerId, sign * seconds * 1_000);
      setOpen(false);
    } catch (err) {
      alert(`Adjust failed: ${(err as Error).message}`);
    }
  };
  return (
    <div className="adjust-time">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Adjust time">
        ± {label ?? ""}
      </button>
      {open ? (
        <div className="adjust-popover">
          <label>
            Seconds:{" "}
            <input
              type="number"
              min={1}
              value={seconds}
              onChange={(e) => setSeconds(Math.max(1, Number(e.target.value) || 0))}
              style={{ width: "5rem" }}
            />
          </label>
          <div>
            <button type="button" onClick={() => void apply(-1)}>− subtract</button>
            <button type="button" onClick={() => void apply(1)}>+ add</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
