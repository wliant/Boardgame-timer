"use client";

import { useLiveState } from "@/client/sse";

import { BetweenRoundsScreen } from "./BetweenRoundsScreen";
import { ConfigScreen } from "./ConfigScreen";
import { InGameScreen } from "./InGameScreen";
import { LobbyScreen } from "./LobbyScreen";
import { ReadyScreen } from "./ReadyScreen";
import { StaleIndicator } from "./StaleIndicator";
import { ToastList } from "./ToastList";

export function PhaseRouter() {
  const live = useLiveState();
  if (!live.game) {
    return (
      <main className="screen screen-loading">
        <p>Loading…</p>
      </main>
    );
  }
  const { game, settings } = live;
  let body: React.ReactNode;
  switch (game.phase) {
    case "Lobby":
      body = <LobbyScreen game={game} settings={settings} />;
      break;
    case "Configuring":
      body = <ConfigScreen game={game} settings={settings} />;
      break;
    case "Ready":
      body = <ReadyScreen game={game} settings={settings} />;
      break;
    case "Running":
    case "Paused":
      body = <InGameScreen game={game} settings={settings} />;
      break;
    case "BetweenRounds":
      body = <BetweenRoundsScreen game={game} />;
      break;
  }
  return (
    <>
      {body}
      <ToastList toasts={live.toasts} onDismiss={live.dismissToast} />
      <StaleIndicator staleSince={live.staleSince} />
    </>
  );
}
