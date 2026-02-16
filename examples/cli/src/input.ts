/**
 * Input bar: text input with slash command dispatch.
 *
 * Handles message sending and routes slash commands to the
 * appropriate handler (create, join, leave, help, quit).
 */

import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { colors, borders, styled } from "./theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InputHandlers = {
  onSend: (text: string) => Promise<void>;
  onCommand: (cmd: string, arg: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let inputBox: InputRenderable;
let statusText: TextRenderable;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function createInputBar(
  renderer: CliRenderer,
  handlers: InputHandlers,
): { bar: BoxRenderable; input: InputRenderable; status: TextRenderable } {
  const bar = new BoxRenderable(renderer, {
    id: "input-bar",
    height: 4,
    flexDirection: "column",
    backgroundColor: colors.bg,
  });

  // Status line
  statusText = new TextRenderable(renderer, {
    id: "status",
    content: styled.muted(" Connecting..."),
    height: 1,
    paddingLeft: 1,
  });

  // Input container with border
  const inputContainer = new BoxRenderable(renderer, {
    id: "input-container",
    height: 3,
    ...borders.input,
  });

  inputBox = new InputRenderable(renderer, {
    id: "input",
    placeholder: "Type a message... (Enter to send, ? for help)",
  });

  inputContainer.add(inputBox);
  bar.add(statusText);
  bar.add(inputContainer);

  // Event handler
  inputBox.on(InputRenderableEvents.ENTER, async (text: string) => {
    if (!text.trim()) return;

    // Clear input immediately
    clearInput();

    // Slash commands
    if (text.startsWith("/")) {
      const [cmd, ...rest] = text.trim().split(" ");
      await handlers.onCommand(cmd!, rest.join(" ").trim());
      return;
    }

    // Regular message
    await handlers.onSend(text.trim());
  });

  return { bar, input: inputBox, status: statusText };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearInput(): void {
  try {
    inputBox.value = "";
  } catch {
    try {
      inputBox.deleteLine();
    } catch {
      /* best effort */
    }
  }
}

export function setStatus(text: string): void {
  statusText.content = text;
}

export function focusInput(): void {
  inputBox.focus();
}
