/**
 * `component.account.*` — provider-linked auth accounts.
 *
 * Reads collapse into one overloaded `get`; `list`
 * takes the owning `userId`.
 *
 * @module
 */

export {
  accountGet as get,
  accountList as list,
  accountInsert as create,
  accountPatch as update,
  accountDelete as delete,
} from "./public/identity/accounts";
