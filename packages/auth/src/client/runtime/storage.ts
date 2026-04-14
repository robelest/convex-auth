import { LOG_LEVELS, logMessage } from "../../shared/log";
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
    try {
      return (await storage.getItem(key(name))) ?? null;
    } catch (error) {
      logMessage("convex-auth/client", LOG_LEVELS.ERROR, [
        `[convex-auth] Failed to read ${name} from storage:`,
        error,
      ]);
      return null;
    }
  };

  const set = async (name: string, value: string): Promise<boolean> => {
    if (!storage) {
      return true;
    }
    try {
      await storage.setItem(key(name), value);
      return true;
    } catch (error) {
      logMessage("convex-auth/client", LOG_LEVELS.ERROR, [
        `[convex-auth] Failed to write ${name} to storage:`,
        error,
      ]);
      return false;
    }
  };

  const remove = async (name: string): Promise<boolean> => {
    if (!storage) {
      return true;
    }
    try {
      await storage.removeItem(key(name));
      return true;
    } catch (error) {
      logMessage("convex-auth/client", LOG_LEVELS.ERROR, [
        `[convex-auth] Failed to remove ${name} from storage:`,
        error,
      ]);
      return false;
    }
  };

  return { get, set, remove };
}
