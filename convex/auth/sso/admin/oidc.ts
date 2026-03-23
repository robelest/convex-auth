import { sso } from "@robelest/convex-auth/server";

import { auth, authorizeAdmin } from "../../../auth";

export const { configure, get, validate } = sso(auth, {
  authorizeAdmin,
}).admin.oidc;
