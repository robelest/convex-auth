/**
 * `component.sso.connection.domain.verification.*` — domain
 * ownership-proof records (sub-resource of connection.domain).
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix.
 *
 * @module
 */

export {
  groupConnectionDomainVerificationGet as get,
  groupConnectionDomainVerificationUpsert as upsert,
  groupConnectionDomainVerificationDelete as delete,
} from "../../../public/sso/domains";
