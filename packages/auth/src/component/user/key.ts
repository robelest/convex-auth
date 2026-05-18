/**
 * `component.user.key.*` — API keys (programmatic access credentials,
 * a sub-resource of user).
 *
 * Reads collapse into one overloaded `get`.
 *
 * @module
 */

export {
  keyGet as get,
  keyList as list,
  keyInsert as create,
  keyPatch as update,
  keyDelete as delete,
} from "../public/security/keys";
