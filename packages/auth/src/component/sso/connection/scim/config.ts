/**
 * `component.sso.connection.scim.config.*` — SCIM provisioning config
 * for an SSO connection (sub-resource of connection).
 *
 * Reads collapse into one overloaded `get`
 * (`{ connectionId }` or `{ tokenHash }`).
 *
 * @module
 */

export {
  groupConnectionScimConfigGet as get,
  groupConnectionScimConfigUpsert as upsert,
} from "../../../public/sso/scim";
