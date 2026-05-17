/**
 * `component.account.*` — provider-linked auth accounts.
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. Reads collapse into one overloaded `get`.
 *
 * @module
 */

export {
  accountGet as get,
  accountListByUser as listByUser,
  accountInsert as create,
  accountPatch as update,
  accountDelete as delete,
} from "./public/identity/accounts";
