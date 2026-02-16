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

import { tryRestoreSession, clearSavedTokens } from "./auth";
import {
  initTUI,
  enterChat,
  cleanup,
  updateAuthStatus,
  runAuthFlow,
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

const restored = await tryRestoreSession();

if (restored) {
  updateAuthStatus("Session restored!");
} else {
  try {
    await runAuthFlow();
  } catch (e) {
    updateAuthStatus(
      `Auth failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    await Bun.sleep(3000);
    cleanup();
    process.exit(1);
  }
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
