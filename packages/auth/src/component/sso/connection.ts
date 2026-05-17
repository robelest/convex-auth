/**
 * `component.sso.connection.*` — SSO group connections (the connection
 * entity root; domains/secrets/SCIM are sub-resources nested under it).
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. Reads collapse into one overloaded `get`
 * (`{ connectionId }` → doc, `{ domain }` → `{ connection, domain }`).
 *
 * @module
 */

export {
  groupConnectionGet as get,
  groupConnectionList as list,
  groupConnectionCreate as create,
  groupConnectionUpdate as update,
  groupConnectionDelete as delete,
} from "../public/sso/core";
