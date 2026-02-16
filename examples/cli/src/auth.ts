/**
 * Device authorization flow for the CLI.
 *
 * 1. Check Bun.secrets for a saved token
 * 2. If none, initiate device flow via ConvexHttpClient
 * 3. Display user code, open browser, poll until authorized
 * 4. Save token to OS keychain via Bun.secrets
 */

import { ConvexError } from "convex/values";
import { httpClient, setAuth } from "./convex";

const SERVICE = "convex-auth-cli";
const TOKEN_NAME = "auth_token";
const REFRESH_TOKEN_NAME = "refresh_token";

/** Attempt to restore a saved session. Returns true if successful. */
export async function tryRestoreSession(): Promise<boolean> {
  const token = await Bun.secrets.get({ service: SERVICE, name: TOKEN_NAME });
  if (!token) return false;

  try {
    // Set the token, then validate it with an actual API call.
    // If the token is expired the query will throw.
    setAuth(token);
    await httpClient.query("users:viewer" as any, {});
    return true;
  } catch {
    await clearSavedTokens();
    return false;
  }
}

/** Structured data passed alongside status messages. */
export type AuthStatusData = {
  userCode?: string;
  verificationUrl?: string;
};

/** Run the full device authorization flow. */
export async function deviceAuthFlow(
  onStatus: (message: string, data?: AuthStatusData) => void,
): Promise<void> {
  onStatus("Requesting device code...");

  // Step 1: Initiate device flow
  const result: any = await httpClient.action("auth:signIn" as any, {
    provider: "device",
  });

  const deviceCode = result.deviceCode;
  if (!deviceCode) {
    throw new Error("Server did not return a device code.");
  }

  const {
    deviceCode: code,
    userCode,
    verificationUri: _verificationUri,
    verificationUriComplete,
    expiresIn,
    interval: intervalSec,
  } = deviceCode as {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  };

  // Step 2: Display code and open browser
  onStatus("Enter the code below to sign in", {
    userCode,
    verificationUrl: verificationUriComplete,
  });

  // Auto-open in default browser using Bun.spawn
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  try {
    Bun.spawn([openCmd, verificationUriComplete], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    // Silently fail — user can open manually
  }

  // Step 3: Poll until authorized
  let intervalMs = intervalSec * 1000;
  const expiresAt = Date.now() + expiresIn * 1000;

  onStatus("Waiting for authorization...");

  while (Date.now() < expiresAt) {
    await Bun.sleep(intervalMs);

    try {
      const poll: any = await httpClient.action("auth:signIn" as any, {
        provider: "device",
        params: { flow: "poll", deviceCode: code },
      });

      if (poll.tokens) {
        const { token, refreshToken } = poll.tokens as {
          token: string;
          refreshToken?: string;
        };

        // Save to OS keychain
        await Bun.secrets.set({
          service: SERVICE,
          name: TOKEN_NAME,
          value: token,
        });
        if (refreshToken) {
          await Bun.secrets.set({
            service: SERVICE,
            name: REFRESH_TOKEN_NAME,
            value: refreshToken,
          });
        }

        // Configure clients
        setAuth(token);
        onStatus("Authorized!");
        return;
      }
    } catch (e: unknown) {
      if (e instanceof ConvexError) {
        const data = e.data as Record<string, unknown>;
        const errorCode = data?.code as string | undefined;

        if (errorCode === "DEVICE_AUTHORIZATION_PENDING") {
          continue;
        }
        if (errorCode === "DEVICE_SLOW_DOWN") {
          intervalMs += intervalSec * 1000;
          continue;
        }
        if (errorCode === "DEVICE_CODE_EXPIRED") {
          throw new Error("Device code expired. Please try again.");
        }
        if (errorCode === "DEVICE_CODE_DENIED") {
          throw new Error("Authorization was denied.");
        }
      }
      throw e;
    }
  }

  throw new Error("Device authorization timed out.");
}

/** Clear saved tokens from the OS keychain. */
export async function clearSavedTokens(): Promise<void> {
  try {
    await Bun.secrets.delete({ service: SERVICE, name: TOKEN_NAME });
  } catch { /* cleanup */ }
  try {
    await Bun.secrets.delete({ service: SERVICE, name: REFRESH_TOKEN_NAME });
  } catch { /* cleanup */ }
}
