/**
 * `component.sso.connection.scimIdentity.*` — SCIM-provisioned
 * identities for an SSO connection (sub-resource of connection).
 *
 * `get` is overloaded — single lookup or, with `{ connectionId,
 * userIds }`, a batched resolve aligned to input order.
 *
 * @module
 */

export {
  groupConnectionScimIdentityGet as get,
  groupConnectionScimIdentityListByGroupConnection as list,
  groupConnectionScimIdentityUpsert as upsert,
  groupConnectionScimIdentityDelete as delete,
} from "../../public/sso/scim";
