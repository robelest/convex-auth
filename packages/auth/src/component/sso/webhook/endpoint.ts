/**
 * `component.sso.webhook.endpoint.*` — webhook endpoint registrations
 * for SSO event delivery.
 *
 * @module
 */

export {
  groupWebhookEndpointGet as get,
  groupWebhookEndpointList as list,
  groupWebhookEndpointCreate as create,
  groupWebhookEndpointUpdate as update,
} from "../../public/sso/webhooks";
