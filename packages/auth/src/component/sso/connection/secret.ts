/**
 * `component.sso.connection.secret.*` — encrypted IdP secrets for an
 * SSO connection (sub-resource of connection).
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix.
 *
 * @module
 */

export {
  groupConnectionSecretGet as get,
  groupConnectionSecretUpsert as upsert,
  groupConnectionSecretDelete as delete,
} from "../../public/sso/secrets";
