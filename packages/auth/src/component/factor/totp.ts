/**
 * `component.factor.totp.*` — TOTP (authenticator-app) enrollments.
 *
 * Reads collapse into one overloaded `get`;
 * `markVerified` is a kept domain verb (enrollment confirmation with
 * `User.hasTotp` side-effects).
 *
 * @module
 */

export {
  totpGet as get,
  totpList as list,
  totpInsert as create,
  totpMarkVerified as markVerified,
  totpUpdate as update,
  totpDelete as delete,
} from "../public/factors/totp";
