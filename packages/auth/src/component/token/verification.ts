/**
 * `component.token.verification.*` — OTP / magic-link / OAuth codes.
 *
 * Reads collapse into one overloaded `get`.
 *
 * @module
 */

export {
  verificationCodeGet as get,
  verificationCodeCreate as create,
  verificationCodeDelete as delete,
} from "../public/identity/codes";
