/**
 * `component.sso.audit.*` — SSO audit-event log.
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix.
 *
 * @module
 */

export {
  groupAuditEventList as list,
  groupAuditEventCreate as create,
} from "../public/sso/audit";
