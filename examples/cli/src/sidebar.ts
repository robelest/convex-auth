/**
 * Sidebar: channel list + user info footer.
 *
 * ┌─ Channels ─────────────┐
 * │ > # general             │
 * │   # random              │
 * │   # dev                 │
 * │                         │
 * ├─────────────────────────┤
 * │ user@email.com          │
 * │ C:new J:join ?:help     │
 * └─────────────────────────┘
 */

import {
  BoxRenderable,
  TextRenderable,
  TextAttributes,
  t,
  bold,
  fg,
  type CliRenderer,
} from "@opentui/core";
import { colors, borders, styled } from "./theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Group = {
  _id: string;
  name: string;
  role?: string;
};

// ---------------------------------------------------------------------------
// State (owned by chat.ts, passed in via render calls)
// ---------------------------------------------------------------------------

let renderer: CliRenderer;
let container: BoxRenderable;
let channelListBox: BoxRenderable;
let userLabel: TextRenderable;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function createSidebar(r: CliRenderer): BoxRenderable {
  renderer = r;

  container = new BoxRenderable(renderer, {
    id: "sidebar",
    width: 26,
    height: "100%",
    flexDirection: "column",
    backgroundColor: colors.bg1,
    ...borders.sidebar,
  });

  // Title
  const title = new TextRenderable(renderer, {
    id: "sidebar-title",
    content: t` ${bold(fg(colors.orange)("Channels"))}`,
    height: 1,
  });

  // Divider
  const divider = new TextRenderable(renderer, {
    id: "sidebar-divider",
    content: "─".repeat(24),
    height: 1,
    fg: colors.bg2,
  });

  // Channel list (flex-grow fills space)
  channelListBox = new BoxRenderable(renderer, {
    id: "channel-list",
    flexDirection: "column",
    flexGrow: 1,
    paddingTop: 1,
  });

  // Footer — user name + single hint line
  const footer = new BoxRenderable(renderer, {
    id: "sidebar-footer",
    height: 3,
    flexDirection: "column",
    paddingLeft: 1,
  });

  const footerDivider = new TextRenderable(renderer, {
    id: "footer-divider",
    content: "─".repeat(24),
    height: 1,
    fg: colors.bg2,
  });

  userLabel = new TextRenderable(renderer, {
    id: "user-label",
    content: t` ${fg(colors.fg3)("...")}`,
    height: 1,
  });

  const keyhints = new TextRenderable(renderer, {
    id: "keyhints",
    content: t` ${fg(colors.gray)("Press")} ${fg(colors.yellow)("?")} ${fg(colors.gray)("for help")}`,
    height: 1,
  });

  footer.add(footerDivider);
  footer.add(userLabel);
  footer.add(keyhints);

  container.add(title);
  container.add(divider);
  container.add(channelListBox);
  container.add(footer);

  return container;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** Remove all children from a renderable. */
function removeAllChildren(parent: BoxRenderable): void {
  const children = parent.getChildren();
  for (const child of children) {
    child.destroy();
  }
}

export function renderChannels(
  groups: Group[],
  currentGroupId: string | undefined,
): void {
  removeAllChildren(channelListBox);

  const allChannels: { id: string | undefined; name: string }[] = [
    { id: undefined, name: "general" },
    ...groups.map((g) => ({ id: g._id, name: g.name })),
  ];

  for (const channel of allChannels) {
    const isActive = currentGroupId
      ? channel.id === currentGroupId
      : channel.id === undefined;

    if (isActive) {
      // Wrap active channel in a box for backgroundColor
      const itemBox = new BoxRenderable(renderer, {
        id: `ch-box-${channel.id ?? "general"}`,
        height: 1,
        backgroundColor: colors.bg2,
      });
      const itemText = new TextRenderable(renderer, {
        id: `ch-${channel.id ?? "general"}`,
        content: styled.channelActive(channel.name),
        height: 1,
      });
      itemBox.add(itemText);
      channelListBox.add(itemBox);
    } else {
      const item = new TextRenderable(renderer, {
        id: `ch-${channel.id ?? "general"}`,
        content: styled.channel(channel.name, false),
        height: 1,
      });
      channelListBox.add(item);
    }
  }
}

export function setUserInfo(name: string): void {
  userLabel.content = t` ${fg(colors.fg2)(name)}`;
}
