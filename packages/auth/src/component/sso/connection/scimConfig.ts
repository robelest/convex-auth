/**
 * `component.sso.connection.scimConfig.*` — SCIM provisioning config
 * for an SSO connection (sub-resource of connection).
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. Reads collapse into one overloaded `get`
 * (`{ connectionId }` or `{ tokenHash }`).
 *
 * @module
 */

export {
  groupConnectionScimConfigGet as get,
  groupConnectionScimConfigUpsert as upsert,
} from "../../public/sso/scim";
