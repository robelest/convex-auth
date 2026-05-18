/**
 * `component.group.member.*` — group memberships (sub-resource of group).
 *
 * `get` is overloaded — single lookup or, with `{ userId, groupIds }`,
 * a batched resolve aligned to input order. `resolve` is a domain read
 * (hierarchy-aware membership resolution).
 *
 * @module
 */

export {
  memberGet as get,
  memberList as list,
  memberAdd as create,
  memberUpdate as update,
  memberRemove as delete,
  memberResolve as resolve,
} from "../public/groups/members";
