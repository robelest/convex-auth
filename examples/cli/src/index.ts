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
import { startChat, cleanup } from "./chat";

// Handle --logout flag
if (Bun.argv.includes("--logout")) {
  await clearSavedTokens();
  console.log("Logged out. Saved tokens cleared.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

console.log("Convex Auth CLI Chat\n");

const restored = await tryRestoreSession();

if (restored) {
  console.log("Session restored from keychain.\n");
} else {
  console.log("No saved session. Starting device authorization...\n");

  try {
    await deviceAuthFlow((message) => {
      console.log(message);
    });
  } catch (e) {
    console.error(
      `\nAuth failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }

  console.log("\nAuthenticated! Loading chat...\n");
}

// ---------------------------------------------------------------------------
// Chat UI
// ---------------------------------------------------------------------------

try {
  await startChat();
} catch (e) {
  cleanup();
  console.error(
    `\nChat error: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
}
