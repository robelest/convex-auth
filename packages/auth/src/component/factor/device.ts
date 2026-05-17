/**
 * `component.factor.device.*` — OAuth 2.0 Device Authorization Grant
 * records (RFC 8628).
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. Reads collapse into one overloaded `get`;
 * `authorize` / `updateLastPolled` are kept domain verbs (approval
 * workflow and poll-interval enforcement).
 *
 * @module
 */

export {
  deviceGet as get,
  deviceInsert as create,
  deviceAuthorize as authorize,
  deviceUpdateLastPolled as updateLastPolled,
  deviceDelete as delete,
} from "../public/factors/devices";
