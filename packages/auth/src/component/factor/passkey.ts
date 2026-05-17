/**
 * `component.factor.passkey.*` — WebAuthn passkey credentials.
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. Reads collapse into one overloaded `get`;
 * `updateCounter` is a kept domain verb (clone-detection counter sync).
 *
 * @module
 */

export {
  passkeyGet as get,
  passkeyListByUserId as listByUser,
  passkeyInsert as create,
  passkeyUpdateCounter as updateCounter,
  passkeyUpdateMeta as update,
  passkeyDelete as delete,
} from "../public/factors/passkeys";
