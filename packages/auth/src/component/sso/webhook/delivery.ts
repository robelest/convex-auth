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
  groupWebhookDeliveryList as list,
  groupWebhookDeliveryCreate as create,
  groupWebhookDeliveryPatch as update,
} from "../../public/sso/webhooks";
