import { describe, expect, it, vi } from 'vitest';
import { createSerialWriteQueue } from '@/features/storage/serialWriteQueue';

describe('shared serial storage queue', () => {
  it('does not interleave operations and continues after a rejection', async () => {
    const queue = createSerialWriteQueue();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run(async () => {
      order.push('first-start');
      await gate;
      order.push('first-end');
      throw new Error('expected failure');
    });
    const second = queue.run(async () => {
      order.push('second');
      return 2;
    });
    await vi.waitFor(() => expect(order).toEqual(['first-start']));
    release();
    await expect(first).rejects.toThrow('expected failure');
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });
});
