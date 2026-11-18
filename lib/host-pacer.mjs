const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function isRateBlock(status, options = {}) {
  const include403 = options === true || options?.include403 === true || options?.includeForbidden === true;
  return status === 429 || status === 503 || (include403 && status === 403);
}

export function createHostPacer({ concurrency = 1, gapMs = 0, sleep = defaultSleep, now = Date.now, name = 'Host' } = {}) {
  const limit = Math.max(1, Math.floor(concurrency));
  const gap = Math.max(0, gapMs);
  const pending = [];
  let active = 0;
  let starting = false;
  let lastStartedAt = null;
  let tripReason = null;
  const pausedError = () => new Error(`${name} paused for this run: ${tripReason}`);
  const rejectPending = () => { while (pending.length) pending.shift().reject(pausedError()); };

  async function pump() {
    if (starting) return;
    starting = true;
    try {
      while (pending.length && active < limit) {
        if (tripReason !== null) { rejectPending(); break; }
        if (lastStartedAt !== null) {
          const remaining = gap - (now() - lastStartedAt);
          if (remaining > 0) await sleep(remaining);
        }
        if (tripReason !== null) { rejectPending(); break; }
        const item = pending.shift();
        active += 1;
        lastStartedAt = now();
        Promise.resolve().then(item.fn).then(item.resolve, item.reject).finally(() => {
          active -= 1;
          void pump();
        });
      }
    } finally {
      starting = false;
      if (pending.length && active < limit) void pump();
    }
  }

  return {
    concurrency: limit,
    gapMs: gap,
    name,
    run(fn) {
      if (tripReason !== null) return Promise.reject(pausedError());
      return new Promise((resolve, reject) => {
        pending.push({ fn, resolve, reject });
        void pump();
      });
    },
    trip(reason) {
      if (tripReason === null) tripReason = String(reason || 'rate limited');
      rejectPending();
    },
    get tripped() { return tripReason !== null; },
    get reason() { return tripReason; },
  };
}
