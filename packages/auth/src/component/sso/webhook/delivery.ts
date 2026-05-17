/**
 * `component.sso.webhook.delivery.*` — queued webhook delivery attempts
 * (sub-resource of webhook).
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix. `enqueue` is a kept domain verb (queues a delivery);
 * `list` is overloaded (`{ connectionId }` history or `{ now }` ready).
 *
 * @module
 */

export {
  groupWebhookDeliveryList as list,
  groupWebhookDeliveryEnqueue as enqueue,
  groupWebhookDeliveryPatch as update,
} from "../../public/sso/webhooks";
