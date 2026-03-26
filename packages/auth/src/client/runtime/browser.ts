import { Fx } from "@robelest/fx";

/** @internal */
export function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** @internal */
export function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** @internal */
export async function browserMutex<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  const lockManager = (globalThis as any)?.navigator?.locks;
  return lockManager !== undefined
    ? await lockManager.request(key, callback)
    : await manualMutex(key, callback);
}

/** @internal */
export function getStorageListenerRegistry(): Record<
  string,
  (event: StorageEvent) => void
> {
  const globalAny = globalThis as any;
  if (globalAny.__convexAuthStorageListeners === undefined) {
    globalAny.__convexAuthStorageListeners = {} as Record<
      string,
      (event: StorageEvent) => void
    >;
  }
  return globalAny.__convexAuthStorageListeners as Record<
    string,
    (event: StorageEvent) => void
  >;
}

function getManualMutexTails(): Record<string, Promise<void>> {
  const globalAny = globalThis as any;
  if (globalAny.__convexAuthMutexTails === undefined) {
    globalAny.__convexAuthMutexTails = {} as Record<string, Promise<void>>;
  }
  return globalAny.__convexAuthMutexTails as Record<string, Promise<void>>;
}

async function manualMutex<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  const mutexTails = getManualMutexTails();
  const previousTail = mutexTails[key] ?? Promise.resolve();

  let releaseCurrent: (() => void) | undefined;
  const currentTail = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  mutexTails[key] = previousTail.then(
    () => currentTail,
    () => currentTail,
  );

  await Fx.run(
    Fx.from({
      ok: () => previousTail,
      err: () => undefined,
    }).pipe(Fx.recover(() => Fx.succeed(undefined))),
  );
  let result: T;
  let threw = false;
  let thrownError: unknown;
  await Fx.run(
    Fx.from({
      ok: async () => {
        result = await callback();
      },
      err: (e) => e,
    }).pipe(
      Fx.recover((e) => {
        threw = true;
        thrownError = e;
        return Fx.succeed(undefined);
      }),
    ),
  );
  releaseCurrent?.();
  if (mutexTails[key] === currentTail) {
    delete mutexTails[key];
  }
  if (threw) {
    throw thrownError;
  }
  return result!;
}
