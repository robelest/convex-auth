import {
  customQuery,
  customMutation,
} from "convex-helpers/server/customFunctions";
import {
  query as rawQuery,
  mutation as rawMutation,
} from "./_generated/server";
import { AuthCtx } from "@robelest/convex-auth/component";
import { auth } from "./auth";

const authCtx = AuthCtx(auth);

export const query = customQuery(rawQuery, authCtx);
export const mutation = customMutation(rawMutation, authCtx);
