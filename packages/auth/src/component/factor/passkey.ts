/**
 * `component.factor.passkey.*` — WebAuthn passkey credentials.
 *
 * Reads collapse into one overloaded `get`; `update`
 * also carries the post-assertion counter sync (clone detection).
 *
 * @module
 */

export {
  passkeyGet as get,
  passkeyList as list,
  passkeyInsert as create,
  passkeyUpdate as update,
  passkeyDelete as delete,
} from "../public/factors/passkeys";
