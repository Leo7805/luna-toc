/** A rejection-safe serial queue shared by background storage coordinators. */
export interface SerialWriteQueue { run<T>(operation: () => Promise<T> | T): Promise<T>; }
export function createSerialWriteQueue(): SerialWriteQueue {
  let tail: Promise<void> = Promise.resolve();
  return { run<T>(operation: () => Promise<T> | T): Promise<T> {
    const task = tail.catch(() => undefined).then(operation);
    tail = task.then(() => undefined, () => undefined);
    return task;
  } };
}
