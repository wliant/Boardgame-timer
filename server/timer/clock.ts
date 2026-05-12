// Sole time source for the server. Tests inject a fake; production wires `realClock`.
// Required by specs/11-testing-and-dev.md §"Time control in tests".

export interface Clock {
  /** Epoch ms. */
  now(): number;
  /** setInterval analogue returning a clear handle. */
  setInterval(fn: () => void, ms: number): { clear: () => void };
}

export const realClock: Clock = {
  now: () => Date.now(),
  setInterval(fn, ms) {
    const handle = globalThis.setInterval(fn, ms);
    return {
      clear: () => {
        globalThis.clearInterval(handle);
      },
    };
  },
};
