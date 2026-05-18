/**
 * `component.token.pkce.*` — PKCE verifiers.
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. Reads collapse into one overloaded `get`.
 *
 * @module
 */

export {
  verifierGet as get,
  verifierCreate as create,
  verifierPatch as update,
  verifierDelete as delete,
} from "../public/identity/verifiers";
