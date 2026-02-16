/**
 * Dialogs: create channel, join channel, help overlay.
 *
 * Uses @opentui-ui/dialog for modal dialogs and @opentui-ui/toast
 * for transient status notifications.
 *
 * The DialogContainerRenderable owns the border/bg styling via
 * `dialogOptions.style`. Individual dialog content fills the
 * container without adding its own border or width.
 */

import {
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextAttributes,
  t,
  bold,
  fg,
  type CliRenderer,
} from "@opentui/core";
import {
  DialogManager,
  DialogContainerRenderable,
} from "@opentui-ui/dialog";
import {
  toast,
  ToasterRenderable,
} from "@opentui-ui/toast";
import { colors, borders, styled } from "./theme";
import type { Group } from "./sidebar";

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

let manager: DialogManager;
let renderer: CliRenderer;

export function initDialogs(r: CliRenderer): {
  dialogContainer: DialogContainerRenderable;
  toaster: ToasterRenderable;
} {
  renderer = r;
  manager = new DialogManager(renderer);

  const dialogContainer = new DialogContainerRenderable(renderer, {
    manager,
    size: "medium",
    backdropOpacity: 0.4,
    closeOnEscape: true,
    dialogOptions: {
      style: {
        backgroundColor: colors.bg1,
        borderStyle: "double",
        borderColor: colors.yellow,
        border: true,
        padding: 1,
      },
    },
  });

  const toaster = new ToasterRenderable(renderer, {
    position: "bottom-right",
    stackingMode: "stack",
    visibleToasts: 3,
    toastOptions: {
      style: {
        backgroundColor: colors.bg1,
        foregroundColor: colors.fg,
        borderColor: colors.bg3,
      },
      success: { style: { borderColor: colors.green } },
      error: { style: { borderColor: colors.red } },
    },
  });

  return { dialogContainer, toaster };
}

// ---------------------------------------------------------------------------
// Toast helpers
// ---------------------------------------------------------------------------

export function showSuccess(msg: string): void {
  toast.success(msg);
}

export function showError(msg: string): void {
  toast.error(msg);
}

export function showInfo(msg: string): void {
  toast(msg);
}

// ---------------------------------------------------------------------------
// Create Channel Dialog
// ---------------------------------------------------------------------------

export async function showCreateChannelDialog(): Promise<string | undefined> {
  return manager.prompt<string>({
    content: (ctx, { resolve, dismiss }) => {
      const box = new BoxRenderable(ctx, {
        flexDirection: "column",
        gap: 1,
      });

      box.add(
        new TextRenderable(ctx, {
          id: "create-title",
          content: t`${bold(fg(colors.orange)("Create Channel"))}`,
          height: 1,
        }),
      );

      box.add(
        new TextRenderable(ctx, {
          id: "create-hint",
          content: t`${fg(colors.gray)("Enter a name for the new channel:")}`,
          height: 1,
        }),
      );

      const inputContainer = new BoxRenderable(ctx, {
        id: "create-input-box",
        height: 3,
        ...borders.input,
      });

      const input = new InputRenderable(ctx, {
        id: "create-input",
        placeholder: "channel-name",
      });

      input.on(InputRenderableEvents.ENTER, (text: string) => {
        const name = text.trim();
        if (name) resolve(name);
      });

      inputContainer.add(input);
      box.add(inputContainer);

      box.add(
        new TextRenderable(ctx, {
          id: "create-footer",
          content: t`${fg(colors.gray)("Enter: create  Esc: cancel")}`,
          height: 1,
        }),
      );

      // Auto-focus
      setTimeout(() => input.focus(), 50);

      return box;
    },
  });
}

// ---------------------------------------------------------------------------
// Join Channel Dialog
// ---------------------------------------------------------------------------

export async function showJoinChannelDialog(
  joinableGroups: Group[],
): Promise<Group | undefined> {
  if (joinableGroups.length === 0) {
    showInfo("No channels available to join.");
    return undefined;
  }

  return manager.prompt<Group>({
    content: (ctx, { resolve, dismiss }) => {
      const box = new BoxRenderable(ctx, {
        flexDirection: "column",
        gap: 1,
      });

      box.add(
        new TextRenderable(ctx, {
          id: "join-title",
          content: t`${bold(fg(colors.orange)("Join Channel"))}`,
          height: 1,
        }),
      );

      const select = new SelectRenderable(ctx, {
        id: "join-select",
        height: Math.min(joinableGroups.length + 1, 10),
        options: joinableGroups.map((g) => ({
          name: `# ${g.name}`,
          description: g._id,
        })),
      });

      select.on(
        SelectRenderableEvents.ITEM_SELECTED,
        (_index: number, option: { name: string; description: string }) => {
          const group = joinableGroups.find(
            (g) => g._id === option.description,
          );
          if (group) resolve(group);
        },
      );

      box.add(select);

      box.add(
        new TextRenderable(ctx, {
          id: "join-footer",
          content: t`${fg(colors.gray)("Enter: join  Esc: cancel")}`,
          height: 1,
        }),
      );

      // Auto-focus
      setTimeout(() => select.focus(), 50);

      return box;
    },
  });
}

// ---------------------------------------------------------------------------
// Help Dialog
// ---------------------------------------------------------------------------

export async function showHelpDialog(): Promise<void> {
  await manager.alert({
    content: (ctx, { dismiss }) => {
      const box = new BoxRenderable(ctx, {
        flexDirection: "column",
        gap: 0,
      });

      const lines = [
        [t`${bold(fg(colors.orange)("Keyboard Shortcuts"))}`, ""],
        ["", ""],
        [t`  ${fg(colors.yellow)("Enter")}`, t`  ${fg(colors.fg)("Send message")}`],
        [t`  ${fg(colors.yellow)("Tab")}`, t`    ${fg(colors.fg)("Next channel")}`],
        [t`  ${fg(colors.yellow)("S-Tab")}`, t`  ${fg(colors.fg)("Previous channel")}`],
        [t`  ${fg(colors.yellow)("C")}`, t`      ${fg(colors.fg)("Create channel")}`],
        [t`  ${fg(colors.yellow)("J")}`, t`      ${fg(colors.fg)("Join channel")}`],
        [t`  ${fg(colors.yellow)("?")}`, t`      ${fg(colors.fg)("This help")}`],
        [t`  ${fg(colors.yellow)("Ctrl+C")}`, t` ${fg(colors.fg)("Quit")}`],
        ["", ""],
        [t`${bold(fg(colors.orange)("Slash Commands"))}`, ""],
        ["", ""],
        [t`  ${fg(colors.aqua)("/create <name>")}`, t` ${fg(colors.fg)("Create channel")}`],
        [t`  ${fg(colors.aqua)("/join")}`, t`          ${fg(colors.fg)("Browse channels")}`],
        [t`  ${fg(colors.aqua)("/leave")}`, t`         ${fg(colors.fg)("Leave channel")}`],
        [t`  ${fg(colors.aqua)("/auth")}`, t`          ${fg(colors.fg)("Re-authenticate")}`],
        [t`  ${fg(colors.aqua)("/logout")}`, t`        ${fg(colors.fg)("Clear saved tokens")}`],
        [t`  ${fg(colors.aqua)("/help")}`, t`          ${fg(colors.fg)("Show this help")}`],
        [t`  ${fg(colors.aqua)("/quit")}`, t`          ${fg(colors.fg)("Quit")}`],
        ["", ""],
        [t`  ${fg(colors.gray)("Press Esc to close")}`, ""],
      ];

      for (let i = 0; i < lines.length; i++) {
        const [left, right] = lines[i]!;
        const row = new BoxRenderable(ctx, {
          id: `help-row-${i}`,
          flexDirection: "row",
          height: 1,
        });
        row.add(
          new TextRenderable(ctx, {
            id: `help-l-${i}`,
            content: left as string,
          }),
        );
        if (right) {
          row.add(
            new TextRenderable(ctx, {
              id: `help-r-${i}`,
              content: right as string,
            }),
          );
        }
        box.add(row);
      }

      return box;
    },
  });
}
