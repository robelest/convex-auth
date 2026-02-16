/**
 * Message area: scrollable list of chat messages.
 *
 * Own messages are styled differently (green author) to match
 * the web client's right-aligned own-message pattern.
 */

import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  t,
  bold,
  fg,
  dim,
  type CliRenderer,
} from "@opentui/core";
import { colors, styled } from "./theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Message = {
  _id: string;
  body: string;
  author: string;
  userId: string;
  _creationTime: number;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let renderer: CliRenderer;
let messageArea: ScrollBoxRenderable;
let headerText: TextRenderable;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function createMessagePanel(r: CliRenderer): {
  panel: BoxRenderable;
  header: TextRenderable;
  scrollArea: ScrollBoxRenderable;
} {
  renderer = r;

  const panel = new BoxRenderable(renderer, {
    id: "msg-panel",
    flexGrow: 1,
    height: "100%",
    flexDirection: "column",
    backgroundColor: colors.bg,
  });

  // Header bar (wrap in a box to get backgroundColor)
  const headerBox = new BoxRenderable(renderer, {
    id: "msg-header-box",
    height: 1,
    backgroundColor: colors.bg1,
  });

  headerText = new TextRenderable(renderer, {
    id: "msg-header",
    content: t` ${bold(fg(colors.aqua)("# general"))}`,
    height: 1,
  });

  headerBox.add(headerText);

  // Message scroll area
  messageArea = new ScrollBoxRenderable(renderer, {
    id: "msg-scroll",
    flexGrow: 1,
    paddingLeft: 1,
    paddingRight: 1,
  });

  panel.add(headerBox);
  panel.add(messageArea);

  return { panel, header: headerText, scrollArea: messageArea };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** Remove all children from a renderable. */
function removeAllChildren(
  parent: BoxRenderable | ScrollBoxRenderable,
): void {
  const children = parent.getChildren();
  for (const child of children) {
    child.destroy();
  }
}

export function setChannelHeader(
  name: string,
  messageCount: number,
): void {
  const countStr = messageCount > 0 ? ` (${messageCount})` : "";
  headerText.content = t` ${bold(fg(colors.aqua)(`# ${name}`))}${fg(colors.gray)(countStr)}`;
}

export function renderMessages(
  messages: Message[],
  currentUserId: string | undefined,
): void {
  removeAllChildren(messageArea);

  if (messages.length === 0) {
    messageArea.add(
      new TextRenderable(renderer, {
        id: "empty-msg",
        content: styled.empty("  No messages yet. Start the conversation!"),
      }),
    );
    return;
  }

  for (const msg of messages) {
    const isOwn = currentUserId !== undefined && msg.userId === currentUserId;
    const time = new Date(msg._creationTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const line = new BoxRenderable(renderer, {
      id: `msg-${msg._id}`,
      flexDirection: "row",
      gap: 1,
    });

    line.add(
      new TextRenderable(renderer, {
        id: `msg-t-${msg._id}`,
        content: styled.timestamp(time),
      }),
    );

    line.add(
      new TextRenderable(renderer, {
        id: `msg-a-${msg._id}`,
        content: styled.author(msg.author, isOwn),
      }),
    );

    line.add(
      new TextRenderable(renderer, {
        id: `msg-b-${msg._id}`,
        content: styled.message(msg.body, isOwn),
      }),
    );

    messageArea.add(line);
  }

  // Scroll to bottom
  try {
    messageArea.scrollTo({ x: 0, y: messageArea.scrollHeight });
  } catch {
    /* scrollHeight may not be ready */
  }
}
