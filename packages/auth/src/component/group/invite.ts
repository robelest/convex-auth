/**
 * `component.group.invite.*` — group invitations (sub-resource of group).
 *
 * `accept` / `acceptByToken` / `revoke` are kept
 * domain verbs (acceptance workflow with side-effects).
 *
 * @module
 */

export {
  inviteGet as get,
  inviteList as list,
  inviteCreate as create,
  inviteAccept as accept,
  inviteAcceptByToken as acceptByToken,
  inviteRevoke as revoke,
} from "../public/groups/invites";
