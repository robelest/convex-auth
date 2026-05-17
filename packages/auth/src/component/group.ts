/**
 * `component.group.*` — hierarchical groups (the group entity root;
 * members/invites are sub-resources under `group.member` / `group.invite`).
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. `ancestors` is a kept domain read (hierarchy walk).
 *
 * @module
 */

export {
  groupGet as get,
  groupAncestors as ancestors,
  groupList as list,
  groupCreate as create,
  groupUpdate as update,
  groupDelete as delete,
} from "./public/groups/core";
