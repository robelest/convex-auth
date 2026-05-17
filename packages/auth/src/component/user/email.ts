/**
 * `component.user.email.*` — emails a user owns (sub-resource of user).
 *
 * Namespace = module path (`component/user/email.ts` → `user.email`),
 * mirroring the consumer facade `auth.user.email.{list,add,remove,
 * primary}`. No `userEmail` compound, no `public` wrapper.
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
