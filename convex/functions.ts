import {
  customAction,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";

import { action, mutation, query } from "./_generated/server";
import { auth } from "./auth/core";

export const authQuery = customQuery(query, auth.ctx());
export const authMutation = customMutation(mutation, auth.ctx());
export const authAction = customAction(action, auth.ctx());
