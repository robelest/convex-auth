/**
 * `component.sso.webhook.endpoint.*` — webhook endpoint registrations
 * for SSO event delivery.
 *
 * Pure re-export barrel; namespace = module path. No `public` wrapper,
 * no entity prefix.
 *
 * @module
 */

export {
  groupWebhookEndpointGet as get,
  groupWebhookEndpointList as list,
  groupWebhookEndpointCreate as create,
  groupWebhookEndpointUpdate as update,
} from "../../public/sso/webhooks";
