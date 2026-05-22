/**
 * `component.maintenance.*` — scheduled cleanup utilities.
 *
 * Wire `pruneExpired` to a daily cron in the consumer app to keep tables
 * with expiring rows (sessions, refresh tokens, verification codes, PKCE
 * verifiers, invites, device codes) bounded.
 *
 * @module
 */

export { pruneExpired } from "./public/maintenance/cleanup";
