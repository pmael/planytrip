/**
 * Runs tasks one after the other, never starting two closer than `minIntervalMs`, for the free
 * public services (geocoder, routing) that ask for fair use. A failing task does not block the next.
 */
export function createThrottle(minIntervalMs: number) {
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = 0;

  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      const wait = lastStart + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastStart = Date.now();
      return task();
    });
    queue = result.catch(() => undefined);
    return result;
  };
}
