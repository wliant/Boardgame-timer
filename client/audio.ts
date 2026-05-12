// WebAudio 440 Hz sine tone with a 1 Hz gate (200 ms on, 800 ms off).
// Primed by the first click anywhere. See specs/04-in-game-behavior.md §"Audio implementation".

let ctx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gain: GainNode | null = null;
let gateInterval: ReturnType<typeof setInterval> | null = null;
let primed = false;
let primerInstalled = false;
let unavailable = false;

function installPrimer(): void {
  if (primerInstalled || typeof window === "undefined") return;
  primerInstalled = true;
  const handler = () => {
    void primeAudio();
    window.removeEventListener("click", handler);
    window.removeEventListener("keydown", handler);
  };
  window.addEventListener("click", handler, { once: false });
  window.addEventListener("keydown", handler, { once: false });
}

async function primeAudio(): Promise<void> {
  if (primed || unavailable) return;
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) {
      unavailable = true;
      return;
    }
    ctx = new AC();
    await ctx.resume();
    primed = true;
  } catch {
    unavailable = true;
  }
}

export function installAudioPrimer(): void {
  installPrimer();
}

export function isAudioUnavailable(): boolean {
  return unavailable;
}

export function startAlertLoop(): void {
  if (!primed || !ctx || unavailable) return;
  if (oscillator) return; // already running
  gain = ctx.createGain();
  gain.gain.value = 0;
  oscillator = ctx.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = 440;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  // 1 Hz cycle: 200 ms on, 800 ms off (spec 04 §audio implementation).
  const cycle = () => {
    if (!gain || !ctx) return;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    setTimeout(() => {
      if (!gain || !ctx) return;
      gain.gain.setValueAtTime(0, ctx.currentTime);
    }, 200);
  };
  cycle();
  gateInterval = setInterval(cycle, 1000);
}

export function stopAlertLoop(): void {
  if (gateInterval) {
    clearInterval(gateInterval);
    gateInterval = null;
  }
  if (oscillator) {
    try {
      oscillator.stop();
    } catch {
      /* ignore */
    }
    oscillator.disconnect();
    oscillator = null;
  }
  if (gain) {
    gain.disconnect();
    gain = null;
  }
}
