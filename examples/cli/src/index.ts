#!/usr/bin/env bun

/**
 * Convex Auth CLI Chat
 *
 * A terminal chat client that authenticates via the Device Authorization
 * flow (RFC 8628) and provides a real-time chat UI using OpenTUI.
 *
 * Usage:
 *   bun run examples/cli/src/index.ts
 *   # or
 *   cd examples/cli && bun start
 */

import { tryRestoreSession, deviceAuthFlow, clearSavedTokens } from "./auth";
import {
  initTUI,
  enterChat,
  cleanup,
  updateAuthStatus,
  showAuthCode,
} from "./chat";

// Handle --logout flag (runs before TUI)
if (Bun.argv.includes("--logout")) {
  await clearSavedTokens();
  console.log("Logged out. Saved tokens cleared.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Boot TUI first, then authenticate inside it
// ---------------------------------------------------------------------------

try {
  await initTUI();
} catch (e) {
  console.error(
    `\nFailed to start TUI: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Auth (displayed inside TUI)
// ---------------------------------------------------------------------------

updateAuthStatus("Checking for saved session...");

const restored = await tryRestoreSession();

if (restored) {
  updateAuthStatus("Session restored! Loading chat...");
} else {
  updateAuthStatus("No saved session. Starting device authorization...");

  try {
    await deviceAuthFlow((message, data) => {
      if (data?.userCode && data?.verificationUrl) {
        showAuthCode(data.userCode, data.verificationUrl);
      }
      updateAuthStatus(message);
    });
  } catch (e) {
    updateAuthStatus(
      `Auth failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    // Give user a moment to read the error before exiting
    await Bun.sleep(3000);
    cleanup();
    process.exit(1);
  }

  updateAuthStatus("Authenticated! Loading chat...");
}

// ---------------------------------------------------------------------------
// Chat UI
// ---------------------------------------------------------------------------

try {
  await enterChat();
} catch (e) {
  cleanup();
  console.error(
    `\nChat error: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
}
