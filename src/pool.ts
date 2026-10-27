/** 最多 limit 个任务同时执行，每个钱包在一次调用里只跑一个任务。 */
export async function mapPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("并发上限至少为 1");
  if (items.length === 0) return;
  let cursor = 0;
  const width = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await fn(items[index]!, index);
      }
    }),
  );
}
