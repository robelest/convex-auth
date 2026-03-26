import { Fx } from "@robelest/fx";

import type { Storage } from "../core/types";

/** @internal */
export function createStorageHelpers(args: {
  storage: Storage | null;
  key: (name: string) => string;
}) {
  const { storage, key } = args;

  const get = async (name: string): Promise<string | null> => {
    if (!storage) {
      return null;
    }
    return Fx.run(
      Fx.from({
        ok: async () => (await storage.getItem(key(name))) ?? null,
        err: (e) => e,
      }).pipe(
        Fx.inspect((error) =>
          Fx.sync(() =>
            console.error(
              `[convex-auth] Failed to read ${name} from storage:`,
              error,
            ),
          ),
        ),
        Fx.recover(() => Fx.succeed(null)),
      ),
    );
  };

  const set = async (name: string, value: string): Promise<void> => {
    if (!storage) {
      return;
    }
    await Fx.run(
      Fx.from({
        ok: () => storage.setItem(key(name), value),
        err: (e) => e,
      }).pipe(
        Fx.inspect((error) =>
          Fx.sync(() =>
            console.error(
              `[convex-auth] Failed to write ${name} to storage:`,
              error,
            ),
          ),
        ),
        Fx.recover(() => Fx.succeed(undefined)),
      ),
    );
  };

  const remove = async (name: string): Promise<void> => {
    if (!storage) {
      return;
    }
    await Fx.run(
      Fx.from({
        ok: () => storage.removeItem(key(name)),
        err: (e) => e,
      }).pipe(
        Fx.inspect((error) =>
          Fx.sync(() =>
            console.error(
              `[convex-auth] Failed to remove ${name} from storage:`,
              error,
            ),
          ),
        ),
        Fx.recover(() => Fx.succeed(undefined)),
      ),
    );
  };

  return { get, set, remove };
}
