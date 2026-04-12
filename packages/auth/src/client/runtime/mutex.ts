const mutexTails: Record<string, Promise<void>> = {};

/** @internal */
export async function localMutex<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  const previousTail = mutexTails[key] ?? Promise.resolve();

  let releaseCurrent: (() => void) | undefined;
  const currentTail = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  mutexTails[key] = previousTail.then(
    () => currentTail,
    () => currentTail,
  );

  try {
    await previousTail;
  } catch {
    // Ignore previous task failures and continue the queue.
  }

  try {
    return await callback();
  } finally {
    releaseCurrent?.();
    if (mutexTails[key] === currentTail) {
      delete mutexTails[key];
    }
  }
}
