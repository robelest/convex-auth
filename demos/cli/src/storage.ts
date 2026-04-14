import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { Storage } from "@robelest/convex-auth/client";

const CONFIG_DIR = path.join(homedir(), ".config", "convex-auth-demo");
const STORAGE_PATH = path.join(CONFIG_DIR, "auth.json");

type StorageShape = Record<string, string>;
export type SessionShape = {
  token: string;
  refreshToken?: string;
};

async function readStorage(): Promise<StorageShape> {
  try {
    const raw = await readFile(STORAGE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as StorageShape)
      : {};
  } catch {
    return {};
  }
}

async function writeStorage(data: StorageShape) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(STORAGE_PATH, JSON.stringify(data, null, 2));
}

export function createFileStorage(): Storage {
  return {
    async getItem(key) {
      const data = await readStorage();
      return data[key] ?? null;
    },
    async setItem(key, value) {
      const data = await readStorage();
      data[key] = value;
      await writeStorage(data);
    },
    async removeItem(key) {
      const data = await readStorage();
      delete data[key];
      await writeStorage(data);
    },
  };
}

export async function clearStoredSession() {
  await rm(STORAGE_PATH, { force: true });
}

export async function readStoredSession(): Promise<SessionShape | null> {
  const data = await readStorage();
  if (!data.token) {
    return null;
  }
  return {
    token: data.token,
    ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
  };
}

export async function writeStoredSession(session: SessionShape) {
  await writeStorage({
    token: session.token,
    ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
  });
}
