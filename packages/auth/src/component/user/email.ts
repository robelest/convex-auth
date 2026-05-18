/**
 * `component.user.email.*` — emails a user owns (sub-resource of user).
 *
 * Mirrors the consumer facade `auth.user.email.{list,add,remove,
 * primary}`.
 *
 * @module
 */

export {
  userEmailListByUser as list,
  userEmailFindVerified as findOwner,
  userEmailUpsert as upsert,
  userEmailSetPrimary as setPrimary,
  userEmailRemove as delete,
} from "../public/identity/users";
