/**
 * `component.token.pkce.*` — PKCE verifiers.
 *
 * Reads collapse into one overloaded `get`.
 *
 * @module
 */

export {
  verifierGet as get,
  verifierCreate as create,
  verifierPatch as update,
  verifierDelete as delete,
} from "../public/identity/verifiers";
