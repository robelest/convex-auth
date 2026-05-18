/**
 * `component.factor.totp.*` — TOTP (authenticator-app) enrollments.
 *
 * Reads collapse into one overloaded `get`. Enrollment is confirmed via
 * `update(id, { verified: true })`.
 *
 * @module
 */

export {
  totpGet as get,
  totpList as list,
  totpInsert as create,
  totpUpdate as update,
  totpDelete as delete,
} from "../public/factors/totp";
