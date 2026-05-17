/**
 * `component.session.*` — auth sessions.
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. `issue` is a kept domain verb (token issuance).
 *
 * @module
 */

export {
  sessionGetById as get,
  sessionList as list,
  sessionListByUser as listByUser,
  sessionCreate as create,
  sessionIssue as issue,
  sessionDelete as delete,
} from "./public/identity/sessions";
