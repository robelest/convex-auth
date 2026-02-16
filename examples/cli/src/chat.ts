/**
 * @module chat
 *
 * Main chat orchestrator for the terminal UI.
 *
 * Two-phase startup:
 *   1. `initTUI()` — creates the renderer and shows an auth screen
 *   2. `enterChat()` — replaces the auth screen with the full chat layout
 *
 * ```
 * ┌──────────┬─────────────────────────┐
 * │ Channels │ # general          (12) │
 * │          ├─────────────────────────┤
 * │ > general│ Messages...             │
 * │   random │                         │
 * │          ├─────────────────────────┤
 * │ user@... │ 12 messages in #general │
 * │ C:new    │ > Type a message...     │
 * └──────────┴─────────────────────────┘
 * ```
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
import { httpClient, realtimeClient, authReady } from "./convex";
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

/** Auth screen elements. */
let authScreen: BoxRenderable | null = null;
let authTitleText: TextRenderable | null = null;
let authStatusText: TextRenderable | null = null;
let authCodeText: TextRenderable | null = null;
let authUrlText: TextRenderable | null = null;
let authHintText: TextRenderable | null = null;

// ---------------------------------------------------------------------------
// Phase 1: Init TUI + Auth screen
// ---------------------------------------------------------------------------

/**
 * Create the renderer and show a centered auth screen.
 *
 * Call this before starting the auth flow so the user sees
 * status updates in the TUI instead of raw console output.
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

  // Full-screen dark background
  authScreen = new BoxRenderable(renderer, {
    id: "auth-screen",
    width: "100%",
    height: "100%",
    backgroundColor: colors.bg,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  });

  // Auth card
  const card = new BoxRenderable(renderer, {
    id: "auth-card",
    width: 52,
    height: 14,
    flexDirection: "column",
    backgroundColor: colors.bg1,
    ...borders.dialog,
    padding: 1,
    gap: 1,
  });

  authTitleText = new TextRenderable(renderer, {
    id: "auth-title",
    content: t`  ${bold(fg(colors.orange)("Convex Auth CLI Chat"))}`,
    height: 1,
  });

  authStatusText = new TextRenderable(renderer, {
    id: "auth-status",
    content: t`  ${fg(colors.fg3)("Checking for saved session...")}`,
    height: 1,
  });

  authCodeText = new TextRenderable(renderer, {
    id: "auth-code",
    content: "",
    height: 2,
  });

  authUrlText = new TextRenderable(renderer, {
    id: "auth-url",
    content: "",
    height: 2,
  });

  authHintText = new TextRenderable(renderer, {
    id: "auth-hint",
    content: t`  ${dim(fg(colors.gray)("Ctrl+C to quit"))}`,
    height: 1,
  });

  card.add(authTitleText);
  card.add(authStatusText);
  card.add(authCodeText);
  card.add(authUrlText);
  card.add(authHintText);
  authScreen.add(card);
  renderer.root.add(authScreen);
}

/**
 * Update the auth screen with a status message.
 */
export function updateAuthStatus(status: string): void {
  if (authStatusText) {
    authStatusText.content = t`  ${fg(colors.fg3)(status)}`;
  }
}

/**
 * Show the device code and verification URL on the auth screen.
 */
export function showAuthCode(userCode: string, verificationUrl: string): void {
  if (authCodeText) {
    authCodeText.content = t`  ${fg(colors.gray)("Your code:")} ${bold(fg(colors.yellow)(userCode))}`;
  }
  if (authUrlText) {
    authUrlText.content = t`  ${fg(colors.gray)("Open:")} ${fg(colors.aqua)(verificationUrl)}`;
  }
  if (authHintText) {
    authHintText.content = t`  ${dim(fg(colors.gray)("Waiting for authorization...  Ctrl+C to quit"))}`;
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Enter chat
// ---------------------------------------------------------------------------

/**
 * Replace the auth screen with the full chat layout.
 *
 * Waits for the realtime client to confirm authentication,
 * fetches the current user, and starts subscriptions.
 */
export async function enterChat(): Promise<void> {
  // Remove auth screen
  if (authScreen) {
    authScreen.destroy();
    authScreen = null;
    authTitleText = null;
    authStatusText = null;
    authCodeText = null;
    authUrlText = null;
    authHintText = null;
  }

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

  // Wait for auth confirmation from realtime client
  setStatus("Connecting...");
  await authReady;

  // Loading state
  setStatus("Loading...");

  // Fetch current user identity
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

  // Start subscriptions
  subscribeToGroups();
  subscribeToMessages();

  // Focus the input
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

/**
 * Cycle to the next or previous channel.
 *
 * @param direction - `1` for next, `-1` for previous.
 */
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
