/**
 * `component.factor.totp.*` — TOTP (authenticator-app) enrollments.
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. Reads collapse into one overloaded `get`;
 * `markVerified` / `updateLastUsed` are kept domain verbs (enrollment
 * confirmation and usage tracking with `User.hasTotp` side-effects).
 *
 * @module
 */

export {
  totpGet as get,
  totpListByUserId as listByUser,
  totpInsert as create,
  totpMarkVerified as markVerified,
  totpUpdateLastUsed as updateLastUsed,
  totpDelete as delete,
} from "../public/factors/totp";
