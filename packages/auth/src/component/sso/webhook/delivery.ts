/**
 * `component.sso.webhook.delivery.*` — queued webhook delivery attempts
 * (sub-resource of webhook).
 *
 * `list` is overloaded (`{ connectionId }` history or
 * `{ now }` ready-for-dispatch).
 *
 * @module
 */

export {
  groupWebhookDeliveryDispatch as dispatch,
  groupWebhookDeliveryGet as get,
  groupWebhookDeliveryList as list,
  groupWebhookDeliveryCreate as create,
  groupWebhookDeliveryPatch as update,
} from "../../public/sso/webhooks";
