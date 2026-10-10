// @ts-check

/**
 * @template T
 * @typedef {object} PollerOptions
 * @property {number} intervalMs
 * @property {"settled"|"start"} [cadence] Default waits after settlement; start targets start-to-start timing.
 * @property {(signal: AbortSignal) => Promise<T>} fetch
 * @property {(snapshot: T) => void} onData
 * @property {(snapshot: T) => boolean} hasData Caller-owned usable-metric check.
 * @property {(error: unknown) => void} onError
 * @property {(busy: boolean) => void} onBusy
 */

// Scheduling after settlement prevents overlapping requests on a slow NAS.
// Each source supplies its success rule; metadata alone must not reset backoff.
/** @template T */
export class Poller {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  timer;
  /** @type {AbortController|undefined} */
  controller;
  running = false;
  active = false;
  failures = 0;

  /** @param {PollerOptions<T>} options */
  constructor(options) {
    this.options = options;
  }

  start() {
    this.active = true;
    void this.refresh();
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.controller?.abort();
  }

  async refresh() {
    if (this.running) return;
    clearTimeout(this.timer);
    this.running = true;
    const startedAt = performance.now();
    const controller = new AbortController();
    this.controller = controller;
    this.options.onBusy(true);
    try {
      const snapshot = await this.options.fetch(controller.signal);
      if (controller.signal.aborted) return;
      this.options.onData(snapshot);
      this.failures = this.options.hasData(snapshot) ? 0 : this.failures + 1;
    } catch (error) {
      if (!controller.signal.aborted) {
        this.failures++;
        this.options.onError(error);
      }
    } finally {
      this.running = false;
      this.options.onBusy(false);
      if (this.active) {
        let delay = Math.min(
          60000,
          this.options.intervalMs * 2 ** Math.min(this.failures, 3),
        );
        // Live reads include request/render time in their cadence. Slow reads
        // continue after settlement without overlap; failures still back off
        // from completion, even when the failed request took a long time.
        if (this.options.cadence === "start" && this.failures === 0)
          delay = Math.max(0, delay - (performance.now() - startedAt));
        this.timer = setTimeout(() => void this.refresh(), delay);
      }
    }
  }
}
