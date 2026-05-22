/**
 * Component-internal scheduled jobs.
 *
 * @module
 */

import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "auth-prune-expired",
  { hourUTC: 3, minuteUTC: 0 },
  internal.public.maintenance.cleanup.pruneExpired,
  {},
);

export default crons;
