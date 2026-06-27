const mutexTails: Record<string, Promise<void>> = {};

/** @internal */
export async function localMutex<T>(key: string, callback: () => Promise<T>): Promise<T> {
  const previousTail = mutexTails[key] ?? Promise.resolve();

  let releaseCurrent: (() => void) | undefined;
  const currentTail = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  const currentTailPromise = previousTail.then(
    () => currentTail,
    () => currentTail,
  );
  mutexTails[key] = currentTailPromise;

  try {
    await previousTail;
  } catch {
    /* empty */
  }

  try {
    return await callback();
  } finally {
    releaseCurrent?.();
    if (mutexTails[key] === currentTailPromise) {
      delete mutexTails[key];
    }
  }
}
