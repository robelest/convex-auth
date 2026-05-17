/**
 * `component.verificationCode.*` — OTP / magic-link / OAuth codes.
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. Reads collapse into one overloaded `get`.
 *
 * @module
 */

export {
  verificationCodeGet as get,
  verificationCodeCreate as create,
  verificationCodeDelete as delete,
} from "./public/identity/codes";
