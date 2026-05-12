"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/client/api";
import { useLiveState } from "@/client/sse";
import type { AppSettings, Device, MqttBrokerConfig } from "@/shared/types";

import { ConfirmModal } from "./ConfirmModal";

export function SettingsScreen() {
  const live = useLiveState();
  const [brokerDraft, setBrokerDraft] = useState<MqttBrokerConfig | null>(null);
  const [editing, setEditing] = useState<Device | "new" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Device | null>(null);
  const [discoveryActive, setDiscoveryActive] = useState(false);
  const [discoveryEndsAt, setDiscoveryEndsAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize broker draft from current settings.
  useEffect(() => {
    if (live.settings && brokerDraft === null) {
      setBrokerDraft({ ...live.settings.mqttBroker });
    }
  }, [live.settings, brokerDraft]);

  const settings = live.settings;
  const midGameLocked =
    live.game?.phase === "Running" ||
    live.game?.phase === "Paused" ||
    live.game?.phase === "BetweenRounds";

  const saveBroker = async () => {
    if (!settings || !brokerDraft) return;
    setError(null);
    try {
      const next: AppSettings = { ...settings, mqttBroker: brokerDraft };
      await api.putSettings(next);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startDiscovery = async () => {
    setError(null);
    try {
      const { endsAt } = await api.startDiscovery();
      setDiscoveryActive(true);
      setDiscoveryEndsAt(endsAt);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const stopDiscovery = async () => {
    await api.stopDiscovery();
    setDiscoveryActive(false);
    setDiscoveryEndsAt(null);
    live.clearDiscovery();
  };
  useEffect(() => {
    if (!discoveryEndsAt) return;
    const ms = discoveryEndsAt - Date.now();
    if (ms <= 0) {
      setDiscoveryActive(false);
      setDiscoveryEndsAt(null);
      return;
    }
    const t = setTimeout(() => {
      setDiscoveryActive(false);
      setDiscoveryEndsAt(null);
    }, ms);
    return () => clearTimeout(t);
  }, [discoveryEndsAt]);

  const deleteDevice = async (d: Device) => {
    setError(null);
    try {
      await api.deleteDevice(d.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="screen screen-settings">
      <header className="screen-header">
        <h1>Settings</h1>
        <Link href="/" className="link-button">Back</Link>
      </header>

      {midGameLocked ? (
        <div className="banner banner-warn">
          Game in progress — settings are read-only. End the game to make changes.
        </div>
      ) : null}
      {error ? <div className="banner banner-warn">{error}</div> : null}

      <section className="settings-section">
        <h2>MQTT Broker</h2>
        {brokerDraft ? (
          <div className="broker-form">
            <label>
              URL:{" "}
              <input
                type="text"
                value={brokerDraft.url}
                disabled={midGameLocked}
                onChange={(e) => setBrokerDraft({ ...brokerDraft, url: e.target.value })}
                placeholder="mqtt://hostname:1883"
              />
            </label>
            <label>
              Username:{" "}
              <input
                type="text"
                value={brokerDraft.username ?? ""}
                disabled={midGameLocked}
                onChange={(e) => {
                  const v = e.target.value;
                  const next: MqttBrokerConfig = { ...brokerDraft };
                  if (v === "") delete next.username;
                  else next.username = v;
                  setBrokerDraft(next);
                }}
              />
            </label>
            <label>
              Password:{" "}
              <input
                type="password"
                value={brokerDraft.password ?? ""}
                disabled={midGameLocked}
                onChange={(e) => {
                  const v = e.target.value;
                  const next: MqttBrokerConfig = { ...brokerDraft };
                  if (v === "") delete next.password;
                  else next.password = v;
                  setBrokerDraft(next);
                }}
              />
            </label>
            <label>
              Client ID:{" "}
              <input
                type="text"
                value={brokerDraft.clientId}
                disabled={midGameLocked}
                onChange={(e) => setBrokerDraft({ ...brokerDraft, clientId: e.target.value })}
              />
            </label>
            <div>
              <button
                type="button"
                disabled={midGameLocked}
                onClick={() => void saveBroker()}
              >
                Save
              </button>
            </div>
            <div className="status-line">
              Status:{" "}
              {live.game?.mqtt.connected
                ? "✅ connected"
                : `❌ disconnected${live.game?.mqtt.lastError ? ` (${live.game.mqtt.lastError})` : ""}`}
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-section">
        <h2>Physical Devices</h2>
        <ul className="device-list">
          {settings?.devices.map((d) => (
            <li key={d.id} className="device-row">
              <div className="device-info">
                <div className="device-name">{d.name}</div>
                <div className="device-detail">topic: {d.topic}</div>
                <div className="device-detail">
                  actions: {d.acceptedActions?.join(", ") ?? "any"}
                </div>
                {d.lastSeenAt ? (
                  <div className="device-detail">
                    last seen: {new Date(d.lastSeenAt).toLocaleTimeString()}
                  </div>
                ) : null}
              </div>
              <div className="device-actions">
                <button
                  type="button"
                  disabled={midGameLocked}
                  onClick={() => setEditing(d)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={midGameLocked}
                  onClick={() => setDeleteConfirm(d)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="device-actions-row">
          <button
            type="button"
            disabled={midGameLocked}
            onClick={() => setEditing("new")}
          >
            + Add device
          </button>
          {discoveryActive ? (
            <button type="button" onClick={() => void stopDiscovery()}>Stop listening</button>
          ) : (
            <button
              type="button"
              disabled={midGameLocked}
              onClick={() => void startDiscovery()}
            >
              Listen for press…
            </button>
          )}
        </div>
        {discoveryActive ? (
          <div className="discovery-panel">
            <p>Listening for MQTT topics. Press your button now.</p>
            <ul>
              {live.discovery.map((d) => (
                <li key={d.topic}>
                  <code>{d.topic}</code> &nbsp; sample: <code>{d.samplePayload}</code> &nbsp;
                  count: {d.count}
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ id: "", name: "", topic: d.topic })
                    }
                  >
                    Use this topic
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {editing != null ? (
        <DeviceModal
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onError={(e) => setError(e)}
        />
      ) : null}

      <ConfirmModal
        open={deleteConfirm != null}
        title="Delete device?"
        body={`Permanently remove "${deleteConfirm?.name ?? ""}"?`}
        confirmLabel="Delete"
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) void deleteDevice(deleteConfirm);
          setDeleteConfirm(null);
        }}
      />
    </main>
  );
}

function DeviceModal({
  initial,
  onClose,
  onError,
}: {
  initial: Device | null;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [actions, setActions] = useState(
    initial?.acceptedActions?.join(", ") ?? "",
  );

  const save = async () => {
    try {
      const acceptedActions = actions.trim()
        ? actions.split(",").map((s) => s.trim()).filter(Boolean)
        : null;
      const payload: { name: string; topic: string; acceptedActions?: string[] | null } = {
        name,
        topic,
      };
      if (acceptedActions === null) payload.acceptedActions = null;
      else payload.acceptedActions = acceptedActions;
      if (initial && initial.id !== "") {
        const patch: { name: string; topic: string; acceptedActions?: string[] | null } = {
          name,
          topic,
        };
        patch.acceptedActions = acceptedActions;
        await api.patchDevice(initial.id, patch);
      } else {
        const body: { name: string; topic: string; acceptedActions?: string[] } = {
          name,
          topic,
        };
        if (acceptedActions !== null) body.acceptedActions = acceptedActions;
        await api.addDevice(body);
      }
      onClose();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{initial && initial.id !== "" ? "Edit device" : "Add device"}</h2>
        <label>
          Name:{" "}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Topic:{" "}
          <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label>
          Accepted actions (comma-separated; empty = any):{" "}
          <input type="text" value={actions} onChange={(e) => setActions(e.target.value)} />
        </label>
        <div className="modal-buttons">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
