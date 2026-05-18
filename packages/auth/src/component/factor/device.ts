/**
 * `component.factor.device.*` — OAuth 2.0 Device Authorization Grant
 * records (RFC 8628).
 *
 * Reads collapse into one overloaded `get`;
 * `authorize` is a kept domain verb (approval workflow).
 *
 * @module
 */

export {
  deviceGet as get,
  deviceInsert as create,
  deviceAuthorize as authorize,
  deviceUpdate as update,
  deviceDelete as delete,
} from "../public/factors/devices";
