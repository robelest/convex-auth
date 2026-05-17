/**
 * `component.rateLimit.*` — failed sign-in brute-force throttle state.
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. `get` is keyed by `identifier`.
 *
 * @module
 */

export {
  rateLimitGet as get,
  rateLimitCreate as create,
  rateLimitPatch as update,
  rateLimitDelete as delete,
} from "./public/security/limits";
