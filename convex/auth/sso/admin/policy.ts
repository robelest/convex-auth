import { sso } from "@robelest/convex-auth/server";

import { auth, authorizeAdmin } from "../../../auth";

export const { get, update, validate } = sso(auth, {
  authorizeAdmin,
}).admin.policy;
