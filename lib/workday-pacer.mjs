const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createWorkdayPacer({
  gapMs = 3000,
  maxPagesPerBoard = 15,
  sleep = defaultSleep,
  now = Date.now,
} = {}) {
  let queue = Promise.resolve();
  let lastFinishedAt = null;
  let tripReason = null;

  const pausedError = () => new Error(`Workday paused for this scan: ${tripReason}`);

  async function execute(fn) {
    if (tripReason !== null) throw pausedError();

    if (lastFinishedAt !== null) {
      const remaining = gapMs - (now() - lastFinishedAt);
      if (remaining > 0) await sleep(remaining);
    }

    if (tripReason !== null) throw pausedError();

    try {
      return await fn();
    } finally {
      lastFinishedAt = now();
    }
  }

  return {
    gapMs,
    maxPagesPerBoard,
    run(fn) {
      if (tripReason !== null) return Promise.reject(pausedError());
      const result = queue.then(() => execute(fn));
      queue = result.catch(() => {});
      return result;
    },
    trip(reason) {
      if (tripReason === null) tripReason = reason;
    },
    get tripped() {
      return tripReason !== null;
    },
    get reason() {
      return tripReason;
    },
  };
}
