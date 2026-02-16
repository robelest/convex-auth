/**
 * @module chat
 *
 * Main chat orchestrator for the terminal UI.
 *
 * Two-phase startup:
 *   1. `initTUI()` — creates the renderer and shows an auth screen
 *   2. `enterChat()` — replaces the auth screen with the full chat layout
 *
 * Re-auth from within chat via `/auth` command reuses the auth screen
 * as an overlay.
 */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  bold,
  fg,
  dim,
  type CliRenderer,
} from "@opentui/core";
import { httpClient, realtimeClient, waitForAuth } from "./convex";
import { colors, borders } from "./theme";
import {
  createSidebar,
  renderChannels,
  setUserInfo,
  type Group,
} from "./sidebar";
import {
  createMessagePanel,
  renderMessages,
  setChannelHeader,
  type Message,
} from "./messages";
import {
  createInputBar,
  setStatus,
  focusInput,
  type InputHandlers,
} from "./input";
import {
  initDialogs,
  showCreateChannelDialog,
  showJoinChannelDialog,
  showHelpDialog,
  showSuccess,
  showError,
  showInfo,
} from "./dialogs";
import { deviceAuthFlow, clearSavedTokens } from "./auth";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let renderer: CliRenderer;
let currentGroupId: string | undefined;
let currentGroupName = "general";
let currentUserId: string | undefined;
let groups: Group[] = [];
let messages: Message[] = [];
let unsubMessages: (() => void) | null = null;
let unsubGroups: (() => void) | null = null;

/** Reference to the InputRenderable for focus-checking in keyboard handler. */
let inputBox: import("@opentui/core").InputRenderable;

/** Auth overlay (used during initial auth and /auth re-auth). */
let authOverlay: BoxRenderable | null = null;
let authStatusLine: TextRenderable | null = null;
let authDetailLines: TextRenderable | null = null;

// ---------------------------------------------------------------------------
// Phase 1: Init TUI + Auth screen
// ---------------------------------------------------------------------------

/**
 * Create the renderer and show the auth screen.
 */
export async function initTUI(): Promise<void> {
  renderer = await createCliRenderer({
    targetFps: 30,
    exitOnCtrlC: false,
  });

  // Ctrl+C always quits
  renderer.keyInput.on("keypress", (key: any) => {
    if (key.ctrl && key.name === "c") {
      cleanup();
      renderer.destroy();
      process.exit(0);
    }
  });

  showAuthOverlay("Checking for saved session...");
}

// ---------------------------------------------------------------------------
// Auth overlay (shared by initial auth + /auth re-auth)
// ---------------------------------------------------------------------------

function showAuthOverlay(status: string): void {
  if (authOverlay) return;

  authOverlay = new BoxRenderable(renderer, {
    id: "auth-overlay",
    width: "100%",
    height: "100%",
    backgroundColor: colors.bg,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  });

  const card = new BoxRenderable(renderer, {
    id: "auth-card",
    width: 54,
    flexDirection: "column",
    backgroundColor: colors.bg1,
    ...borders.sidebar,
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
  });

  const title = new TextRenderable(renderer, {
    id: "auth-title",
    content: t`${bold(fg(colors.orange)("Convex Auth CLI Chat"))}`,
    height: 1,
  });

  const spacer = new TextRenderable(renderer, {
    id: "auth-spacer",
    content: "",
    height: 1,
  });

  authStatusLine = new TextRenderable(renderer, {
    id: "auth-status",
    content: t`${fg(colors.fg3)(status)}`,
    height: 1,
  });

  authDetailLines = new TextRenderable(renderer, {
    id: "auth-details",
    content: "",
    height: 3,
  });

  const hint = new TextRenderable(renderer, {
    id: "auth-hint",
    content: t`${dim(fg(colors.gray)("Ctrl+C to quit"))}`,
    height: 1,
  });

  card.add(title);
  card.add(spacer);
  card.add(authStatusLine);
  card.add(authDetailLines);
  card.add(hint);
  authOverlay.add(card);
  renderer.root.add(authOverlay);
}

function hideAuthOverlay(): void {
  if (authOverlay) {
    authOverlay.destroy();
    authOverlay = null;
    authStatusLine = null;
    authDetailLines = null;
  }
}

/**
 * Update the auth overlay status text.
 */
export function updateAuthStatus(status: string): void {
  if (authStatusLine) {
    authStatusLine.content = t`${fg(colors.fg3)(status)}`;
  }
}

/**
 * Show device code + URL on the auth overlay.
 */
export function showAuthCode(userCode: string, verificationUrl: string): void {
  if (authDetailLines) {
    authDetailLines.content = t`\n${fg(colors.gray)("Code:")}  ${bold(fg(colors.yellow)(userCode))}\n${fg(colors.gray)("Open:")}  ${fg(colors.aqua)(verificationUrl)}`;
  }
}

// ---------------------------------------------------------------------------
// Auth flow (callable from init + /auth command)
// ---------------------------------------------------------------------------

/**
 * Run the full device auth flow inside the TUI.
 * Shows the auth overlay, runs device flow, hides overlay on success.
 */
export async function runAuthFlow(): Promise<void> {
  // Show overlay if not already visible (re-auth from /auth)
  if (!authOverlay) {
    showAuthOverlay("Starting device authorization...");
  }

  updateAuthStatus("Starting device authorization...");

  await deviceAuthFlow((message, data) => {
    if (data?.userCode && data?.verificationUrl) {
      showAuthCode(data.userCode, data.verificationUrl);
    }
    updateAuthStatus(message);
  });

  updateAuthStatus("Authenticated!");
}

// ---------------------------------------------------------------------------
// Phase 2: Enter chat
// ---------------------------------------------------------------------------

/**
 * Replace the auth screen with the full chat layout.
 *
 * Waits for the realtime client to confirm authentication (with timeout),
 * fetches the current user, and starts subscriptions.
 */
export async function enterChat(): Promise<void> {
  hideAuthOverlay();

  // Root layout — horizontal flex
  const main = new BoxRenderable(renderer, {
    id: "main",
    width: "100%",
    height: "100%",
    flexDirection: "row",
    backgroundColor: colors.bg,
  });

  // Sidebar
  const sidebar = createSidebar(renderer);
  main.add(sidebar);

  // Right panel — vertical flex (messages + input)
  const rightPanel = new BoxRenderable(renderer, {
    id: "right-panel",
    flexGrow: 1,
    height: "100%",
    flexDirection: "column",
  });

  const { panel: messagePanel } = createMessagePanel(renderer);
  rightPanel.add(messagePanel);

  const handlers: InputHandlers = {
    onSend: handleSend,
    onCommand: handleCommand,
  };

  const { bar: inputBar, input } = createInputBar(renderer, handlers);
  inputBox = input;
  rightPanel.add(inputBar);

  main.add(rightPanel);
  renderer.root.add(main);

  // Dialogs + toaster (overlay layer)
  const { dialogContainer, toaster } = initDialogs(renderer);
  renderer.root.add(dialogContainer);
  renderer.root.add(toaster);

  // Keyboard shortcuts for chat mode
  setupChatKeyboard();

  // Wait for auth confirmation with timeout
  setStatus("Connecting...");
  try {
    await waitForAuth(8000);
  } catch {
    // Auth timed out — token likely expired, trigger re-auth
    setStatus("Session expired. Run /auth to sign in again.");
    showError("Session expired. Type /auth to re-authenticate.");
    focusInput();
    return;
  }

  await loadUserAndSubscribe();
}

/** Fetch user identity and start realtime subscriptions. */
async function loadUserAndSubscribe(): Promise<void> {
  setStatus("Loading...");

  try {
    const identity: any = await httpClient.query(
      "users:viewer" as any,
      {},
    );
    if (identity) {
      const displayName =
        identity.name || identity.email || identity.phone || "You";
      currentUserId = identity._id;
      setUserInfo(displayName);
    } else {
      setUserInfo("You");
    }
  } catch {
    setUserInfo("You");
  }

  subscribeToGroups();
  subscribeToMessages();
  focusInput();
}

// ---------------------------------------------------------------------------
// Keyboard (chat mode)
// ---------------------------------------------------------------------------

function setupChatKeyboard(): void {
  renderer.keyInput.on("keypress", (key: any) => {
    // Tab / Shift+Tab — cycle channels
    if (key.name === "tab" && !inputBox.focused) {
      cycleChannel(key.shift ? -1 : 1);
      return;
    }

    // Shortcut keys — only when input is NOT focused
    if (inputBox.focused) return;

    switch (key.name) {
      case "c":
        void showCreateChannelDialog().then((name) => {
          if (name) void createChannel(name);
        });
        break;
      case "j":
        void promptJoinChannel();
        break;
      case "?":
        void showHelpDialog();
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Channel navigation
// ---------------------------------------------------------------------------

function cycleChannel(direction: number): void {
  const allChannels: { id: string | undefined; name: string }[] = [
    { id: undefined, name: "general" },
    ...groups.map((g) => ({ id: g._id, name: g.name })),
  ];

  const currentIdx = allChannels.findIndex((c) =>
    currentGroupId ? c.id === currentGroupId : c.id === undefined,
  );
  const next =
    (currentIdx + direction + allChannels.length) % allChannels.length;
  const channel = allChannels[next]!;

  switchToChannel(channel.id, channel.name);
}

function switchToChannel(
  groupId: string | undefined,
  name: string,
): void {
  currentGroupId = groupId;
  currentGroupName = name;
  setChannelHeader(currentGroupName, messages.length);
  renderChannels(groups, currentGroupId);
  subscribeToMessages();
  focusInput();
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

function subscribeToGroups(): void {
  unsubGroups?.();
  unsubGroups = realtimeClient.onUpdate(
    "groups:list" as any,
    {},
    (result: any) => {
      groups = (result as Group[]) ?? [];
      renderChannels(groups, currentGroupId);
    },
  );
}

function subscribeToMessages(): void {
  unsubMessages?.();
  const args = currentGroupId ? { groupId: currentGroupId } : {};
  unsubMessages = realtimeClient.onUpdate(
    "messages:list" as any,
    args,
    (result: any) => {
      messages = (result as Message[]) ?? [];
      renderMessages(messages, currentUserId);
      setChannelHeader(currentGroupName, messages.length);
      const count = messages.length;
      setStatus(
        ` ${count} message${count !== 1 ? "s" : ""} in #${currentGroupName}`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Input handlers
// ---------------------------------------------------------------------------

async function handleSend(body: string): Promise<void> {
  try {
    await httpClient.mutation("messages:send" as any, {
      body,
      ...(currentGroupId ? { groupId: currentGroupId } : {}),
    });
  } catch (e) {
    showError(
      `Send failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function handleCommand(cmd: string, arg: string): Promise<void> {
  switch (cmd) {
    case "/create":
    case "/new": {
      if (!arg) {
        showError("Usage: /create <name>");
        return;
      }
      await createChannel(arg);
      break;
    }

    case "/join": {
      await promptJoinChannel();
      break;
    }

    case "/leave": {
      if (!currentGroupId) {
        showError("Can't leave #general");
        return;
      }
      showInfo("Leave is not implemented yet.");
      break;
    }

    case "/auth": {
      await handleReAuth();
      break;
    }

    case "/logout": {
      await clearSavedTokens();
      showInfo("Tokens cleared. Use /auth to sign in again.");
      break;
    }

    case "/help": {
      void showHelpDialog();
      break;
    }

    case "/quit":
    case "/exit": {
      cleanup();
      renderer.destroy();
      process.exit(0);
      break;
    }

    default: {
      showError(`Unknown: ${cmd}. Type /help`);
    }
  }
}

// ---------------------------------------------------------------------------
// Re-auth from within chat
// ---------------------------------------------------------------------------

async function handleReAuth(): Promise<void> {
  setStatus("Re-authenticating...");

  // Tear down current subscriptions while we re-auth
  cleanup();

  try {
    await runAuthFlow();
    hideAuthOverlay();

    // Wait for the realtime client to pick up the new token
    await waitForAuth(8000);

    showSuccess("Signed in!");
    await loadUserAndSubscribe();
  } catch (e) {
    hideAuthOverlay();
    showError(
      `Auth failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    setStatus("Not authenticated. Use /auth to try again.");
  }
}

// ---------------------------------------------------------------------------
// Channel actions
// ---------------------------------------------------------------------------

async function createChannel(name: string): Promise<void> {
  try {
    const groupId: any = await httpClient.mutation(
      "groups:create" as any,
      { name },
    );
    switchToChannel(groupId as string, name);
    showSuccess(`Created #${name}`);
  } catch (e) {
    showError(
      `Create failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function promptJoinChannel(): Promise<void> {
  try {
    const allGroups: Group[] = await httpClient.query(
      "groups:listAll" as any,
      {},
    );
    const joinable = allGroups.filter(
      (g) => !groups.some((mg) => mg._id === g._id),
    );

    const result = await showJoinChannelDialog(joinable);
    if (!result) return;

    await httpClient.mutation("groups:join" as any, {
      groupId: result._id,
    });
    switchToChannel(result._id, result.name);
    showSuccess(`Joined #${result.name}`);
  } catch (e) {
    showError(
      `Join failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Tear down subscriptions. Safe to call multiple times.
 */
export function cleanup(): void {
  unsubMessages?.();
  unsubMessages = null;
  unsubGroups?.();
  unsubGroups = null;
}
