/**
 * `component.sso.connection.scimIdentity.*` — SCIM-provisioned
 * identities for an SSO connection (sub-resource of connection).
 *
 * Reads collapse into one overloaded `get`; `getMany`
 * batches user lookups under one connection in a single round-trip.
 *
 * @module
 */

export {
  groupConnectionScimIdentityGet as get,
  groupConnectionScimIdentityGetByGroupConnectionAndUsers as getMany,
  groupConnectionScimIdentityListByGroupConnection as list,
  groupConnectionScimIdentityUpsert as upsert,
  groupConnectionScimIdentityDelete as delete,
} from "../../public/sso/scim";
