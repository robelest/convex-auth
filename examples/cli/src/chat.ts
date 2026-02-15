/**
 * OpenTUI chat interface.
 *
 * Full-screen terminal layout:
 * ┌──────────┬─────────────────────────┐
 * │ Channels │ #general                │
 * │          ├─────────────────────────┤
 * │ [+] New  │ Messages...             │
 * │          │                         │
 * │          ├─────────────────────────┤
 * │          │ > Type a message...     │
 * └──────────┴─────────────────────────┘
 */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextAttributes,
  type CliRenderer,
} from "@opentui/core";
import { realtimeClient, httpClient } from "./convex";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Message = {
  _id: string;
  body: string;
  author: string;
  _creationTime: number;
};

type Group = {
  _id: string;
  name: string;
  role?: string;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let renderer: CliRenderer;
let currentGroupId: string | undefined;
let currentGroupName = "general";
let groups: Group[] = [];
let messages: Message[] = [];

// UI elements
let channelList: BoxRenderable;
let header: TextRenderable;
let messageArea: ScrollBoxRenderable;
let inputBox: InputRenderable;
let statusText: TextRenderable;

// Subscription cleanup
let unsubMessages: (() => void) | null = null;
let unsubGroups: (() => void) | null = null;

// Mode: "chat" | "create" | "join"
let mode: "chat" | "create" | "join" = "chat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove all children from a renderable. */
function removeAllChildren(parent: BoxRenderable | ScrollBoxRenderable): void {
  const children = parent.getChildren();
  for (const child of children) {
    child.destroy();
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export async function startChat(): Promise<void> {
  renderer = await createCliRenderer({
    targetFps: 30,
    exitOnCtrlC: false,
  });

  // Main container — horizontal flex
  const main = new BoxRenderable(renderer, {
    id: "main",
    width: "100%",
    height: "100%",
    flexDirection: "row",
  });

  // ----- Sidebar -----
  const sidebar = new BoxRenderable(renderer, {
    id: "sidebar",
    width: 24,
    height: "100%",
    flexDirection: "column",
    border: true,
  });

  const sidebarTitle = new TextRenderable(renderer, {
    id: "sidebar-title",
    content: " Channels",
    attributes: TextAttributes.BOLD,
    height: 1,
    fg: "#7aa2f7",
  });

  const sidebarDivider = new TextRenderable(renderer, {
    id: "sidebar-divider",
    content: "─".repeat(22),
    height: 1,
    fg: "#444444",
  });

  channelList = new BoxRenderable(renderer, {
    id: "channel-list",
    flexDirection: "column",
    flexGrow: 1,
  });

  const sidebarFooter = new BoxRenderable(renderer, {
    id: "sidebar-footer",
    height: 3,
    flexDirection: "column",
    paddingLeft: 1,
  });

  const footerDivider = new TextRenderable(renderer, {
    id: "footer-divider",
    content: "─".repeat(22),
    height: 1,
    fg: "#444444",
  });

  const footerHelp = new TextRenderable(renderer, {
    id: "footer-help",
    content: " Tab:switch  /help",
    height: 1,
    fg: "#666666",
  });

  const footerQuit = new TextRenderable(renderer, {
    id: "footer-quit",
    content: " Ctrl+C: quit",
    height: 1,
    fg: "#666666",
  });

  sidebarFooter.add(footerDivider);
  sidebarFooter.add(footerHelp);
  sidebarFooter.add(footerQuit);

  sidebar.add(sidebarTitle);
  sidebar.add(sidebarDivider);
  sidebar.add(channelList);
  sidebar.add(sidebarFooter);

  // ----- Chat area -----
  const chatArea = new BoxRenderable(renderer, {
    id: "chat-area",
    flexGrow: 1,
    height: "100%",
    flexDirection: "column",
  });

  // Header
  header = new TextRenderable(renderer, {
    id: "header",
    content: ` # ${currentGroupName}`,
    height: 1,
    attributes: TextAttributes.BOLD,
    fg: "#c0caf5",
    backgroundColor: "#1a1b26",
  });

  // Messages
  messageArea = new ScrollBoxRenderable(renderer, {
    id: "messages",
    flexGrow: 1,
  });

  // Status line
  statusText = new TextRenderable(renderer, {
    id: "status",
    content: " Connecting...",
    height: 1,
    fg: "#565f89",
  });

  // Input
  const inputContainer = new BoxRenderable(renderer, {
    id: "input-container",
    height: 3,
    border: true,
  });

  inputBox = new InputRenderable(renderer, {
    id: "input",
    placeholder: "Type a message... (Enter to send)",
  });

  inputContainer.add(inputBox);

  chatArea.add(header);
  chatArea.add(messageArea);
  chatArea.add(statusText);
  chatArea.add(inputContainer);

  main.add(sidebar);
  main.add(chatArea);
  renderer.root.add(main);

  // Focus input
  inputBox.focus();

  // ----- Event handlers -----
  setupKeyboard();
  setupInput();

  // ----- Subscriptions -----
  subscribeToGroups();
  subscribeToMessages();
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function setupKeyboard(): void {
  renderer.keyInput.on("keypress", (key: any) => {
    // Ctrl+C: quit
    if (key.ctrl && key.name === "c") {
      cleanup();
      renderer.destroy();
      process.exit(0);
    }

    // Tab: cycle channels (only in chat mode)
    if (key.name === "tab" && mode === "chat") {
      cycleChannel(key.shift ? -1 : 1);
    }

    // Escape: back to chat mode
    if (key.name === "escape" && mode !== "chat") {
      mode = "chat";
      inputBox.placeholder = "Type a message... (Enter to send)";
      inputBox.focus();
      renderChannelList();
    }
  });
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

function clearInput(): void {
  try {
    inputBox.value = "";
  } catch {
    // Fallback if setter doesn't work
    try {
      inputBox.deleteLine();
    } catch {
      /* best effort */
    }
  }
}

function setupInput(): void {
  inputBox.on(InputRenderableEvents.ENTER, async (text: string) => {
    if (!text.trim()) return;

    // Clear the input immediately
    clearInput();

    // Slash commands
    if (text.startsWith("/")) {
      await handleCommand(text.trim());
      return;
    }

    // Send message
    try {
      await httpClient.mutation("messages:send" as any, {
        body: text.trim(),
        ...(currentGroupId ? { groupId: currentGroupId } : {}),
      });
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

async function handleCommand(input: string): Promise<void> {
  const [cmd, ...rest] = input.split(" ");
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "/create":
    case "/new":
      if (!arg) {
        setStatus("Usage: /create <channel-name>");
        return;
      }
      await createChannel(arg);
      break;

    case "/join":
      void promptJoinChannel();
      break;

    case "/help":
      setStatus(
        " /create <name>  /join  /quit  Tab: switch channel",
      );
      break;

    case "/quit":
    case "/exit":
      cleanup();
      renderer.destroy();
      process.exit(0);
      break;

    default:
      setStatus(`Unknown command: ${cmd}. Type /help for commands.`);
  }
}

// ---------------------------------------------------------------------------
// Channel management
// ---------------------------------------------------------------------------

function cycleChannel(direction: number): void {
  const allChannels = [
    { _id: undefined as string | undefined, name: "general" },
    ...groups,
  ];
  const currentIdx = allChannels.findIndex((c) =>
    currentGroupId ? c._id === currentGroupId : c._id === undefined,
  );
  const next =
    (currentIdx + direction + allChannels.length) % allChannels.length;
  const channel = allChannels[next]!;
  switchToChannel(channel._id, channel.name);
}

function switchToChannel(
  groupId: string | undefined,
  name: string,
): void {
  currentGroupId = groupId;
  currentGroupName = name;
  header.content = ` # ${currentGroupName}`;
  renderChannelList();
  subscribeToMessages();
  inputBox.focus();
}

async function createChannel(name: string): Promise<void> {
  try {
    setStatus(`Creating #${name}...`);
    const groupId: any = await httpClient.mutation("groups:create" as any, {
      name,
    });
    switchToChannel(groupId as string, name);
    setStatus(`Created #${name}`);
  } catch (e) {
    setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
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

    if (joinable.length === 0) {
      setStatus("No channels to join.");
      return;
    }

    mode = "join";
    const select = new SelectRenderable(renderer, {
      id: "join-select",
      width: 30,
      height: Math.min(joinable.length + 2, 12),
      options: joinable.map((g) => ({
        name: `# ${g.name}`,
        description: g._id,
      })),
      position: "absolute",
      left: 26,
      top: 3,
    });

    renderer.root.add(select);
    select.focus();

    select.on(
      SelectRenderableEvents.ITEM_SELECTED,
      async (_index: number, option: { name: string; description: string }) => {
        const group = joinable.find((g) => g._id === option.description);
        if (!group) return;
        try {
          await httpClient.mutation("groups:join" as any, {
            groupId: group._id,
          });
          setStatus(`Joined #${group.name}`);
          switchToChannel(group._id, group.name);
        } catch (e) {
          setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
        }
        select.destroy();
        mode = "chat";
        inputBox.focus();
      },
    );
  } catch (e) {
    setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
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
      renderChannelList();
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
      renderMessages();
      setStatus(
        ` ${messages.length} message${messages.length !== 1 ? "s" : ""} in #${currentGroupName}`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderChannelList(): void {
  removeAllChildren(channelList);

  const allChannels = [
    { _id: undefined as string | undefined, name: "general" },
    ...groups,
  ];

  for (const channel of allChannels) {
    const isActive = currentGroupId
      ? channel._id === currentGroupId
      : channel._id === undefined;

    const item = new TextRenderable(renderer, {
      id: `ch-${channel._id ?? "general"}`,
      content: ` ${isActive ? ">" : " "} # ${channel.name}`,
      height: 1,
      fg: isActive ? "#7aa2f7" : "#a9b1d6",
      attributes: isActive ? TextAttributes.BOLD : 0,
      backgroundColor: isActive ? "#1a1b26" : undefined,
    });

    channelList.add(item);
  }
}

function renderMessages(): void {
  removeAllChildren(messageArea);

  if (messages.length === 0) {
    messageArea.add(
      new TextRenderable(renderer, {
        id: "empty",
        content: "  No messages yet. Start the conversation!",
        fg: "#565f89",
      }),
    );
    return;
  }

  for (const msg of messages) {
    const time = new Date(msg._creationTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const line = new BoxRenderable(renderer, {
      id: `msg-${msg._id}`,
      flexDirection: "row",
      paddingLeft: 1,
      gap: 1,
    });

    line.add(
      new TextRenderable(renderer, {
        id: `msg-time-${msg._id}`,
        content: time,
        fg: "#565f89",
      }),
    );

    line.add(
      new TextRenderable(renderer, {
        id: `msg-author-${msg._id}`,
        content: msg.author,
        fg: "#7aa2f7",
        attributes: TextAttributes.BOLD,
      }),
    );

    line.add(
      new TextRenderable(renderer, {
        id: `msg-body-${msg._id}`,
        content: msg.body,
        fg: "#c0caf5",
      }),
    );

    messageArea.add(line);
  }

  // Scroll to bottom
  try {
    messageArea.scrollTo(0, messageArea.scrollHeight);
  } catch {
    /* scrollHeight may not be ready yet */
  }
}

function setStatus(text: string): void {
  statusText.content = text;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  unsubMessages?.();
  unsubGroups?.();
}

export { cleanup };
