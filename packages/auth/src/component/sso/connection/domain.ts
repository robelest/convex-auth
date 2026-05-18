/**
 * `component.sso.connection.domain.*` — domains linked to an SSO
 * connection (sub-resource of connection).
 *
 * `verify` is a kept domain verb (ownership-proof
 * workflow); ownership-record CRUD nests under `domain.verification`.
 *
 * @module
 */

export {
  groupConnectionDomainList as list,
  groupConnectionDomainAdd as create,
  groupConnectionDomainDelete as delete,
  groupConnectionDomainVerify as verify,
} from "../../public/sso/domains";
