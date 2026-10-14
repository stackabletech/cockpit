/**
 * Run `worker` over `items` with at most `concurrency` calls in flight, in
 * input order. Once `signal` is aborted no further call starts; calls already
 * running settle on their own. Results keep the input order, and items that
 * never started are `undefined`. If a worker throws, the remaining calls still
 * run and the first error is rethrown at the end.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length);
  const errors: unknown[] = [];
  let next = 0;

  async function lane(): Promise<void> {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        errors.push(err);
      }
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  if (errors.length > 0) throw errors[0];
  return results;
}
