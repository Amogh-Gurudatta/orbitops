// Runs async work over a list with a fixed number of requests in flight (bulk acknowledge).

export interface PoolResult {
  done: number;
  failed: number;
}

export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  onProgress?: (progress: PoolResult) => void,
): Promise<PoolResult> {
  const result: PoolResult = { done: 0, failed: 0 };
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await worker(item);
        result.done++;
      } catch {
        result.failed++;
      }
      onProgress?.({ ...result });
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return result;
}
