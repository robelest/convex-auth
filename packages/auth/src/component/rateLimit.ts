/**
 * `component.rateLimit.*` — failed sign-in brute-force throttle state.
 *
 * `get` is keyed by `identifier`.
 *
 * @module
 */

export {
  rateLimitGet as get,
  rateLimitCreate as create,
  rateLimitPatch as update,
  rateLimitDelete as delete,
} from "./public/security/limits";
