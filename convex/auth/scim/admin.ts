import { scim } from "@robelest/convex-auth/server";

import { auth, authorizeAdmin } from "../../auth";

export const { configure, get, validate } = scim(auth, {
  authorizeAdmin,
}).admin;
