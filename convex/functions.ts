import { customAction, customMutation, customQuery } from "convex-helpers/server/customFunctions";

import { action, mutation, query } from "./_generated/server";
import { auth } from "./auth/core";

/**
 * Full-featured auth context: resolves `userId`, `user`, active `groupId`,
 * `role`, and `grants` for every handler. Use this for anything that needs
 * group membership or permission checks — group dashboards, issue mutations,
 * member management, etc.
 *
 * Three component round-trips on the uncached hot path.
 */
export const authQuery = customQuery(query, auth.ctx());
/** See {@link authQuery} — same contract for mutations. */
export const authMutation = customMutation(mutation, auth.ctx());
/** See {@link authQuery} — same contract for actions. */
export const authAction = customAction(action, auth.ctx());

/**
 * Lightweight auth context: resolves only `userId` and `user`; leaves
 * `groupId`, `role`, `grants` as `null` / `[]` without touching the DB.
 *
 * Use this for queries and mutations that operate on the **current user**'s
 * own data and don't care about group membership — profile reads, passkey
 * and API-key listings, self-service settings. One component round-trip
 * instead of three on the common path, about 10–30ms saved per call.
 *
 * If the handler needs group data, switch back to {@link authQuery}.
 */
export const authUserQuery = customQuery(query, auth.ctx({ group: false }));
/** See {@link authUserQuery} — same contract for mutations. */
export const authUserMutation = customMutation(mutation, auth.ctx({ group: false }));
/** See {@link authUserQuery} — same contract for actions. */
export const authUserAction = customAction(action, auth.ctx({ group: false }));
