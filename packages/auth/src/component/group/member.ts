/**
 * `component.group.member.*` — group memberships (sub-resource of group).
 *
 * `resolve` is a kept domain read (hierarchy-aware
 * membership resolution); `getMany` batches group+user pairs.
 *
 * @module
 */

export {
  memberGet as get,
  memberGetByGroupAndUserMany as getMany,
  memberList as list,
  memberAdd as create,
  memberUpdate as update,
  memberRemove as delete,
  memberResolve as resolve,
} from "../public/groups/members";
