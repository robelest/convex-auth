/**
 * `component.group.invite.*` — group invitations (sub-resource of group).
 *
 * `accept` (by id), `redeem` (by token), and `revoke` are domain verbs
 * (acceptance workflow with side-effects).
 *
 * @module
 */

export {
  inviteGet as get,
  inviteList as list,
  inviteCreate as create,
  inviteAccept as accept,
  inviteRedeem as redeem,
  inviteRevoke as revoke,
} from "../public/groups/invites";
