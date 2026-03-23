import { sso } from "@robelest/convex-auth/server";

import { auth, authorizeAdmin } from "../../../auth";

export const { configure, validate } = sso(auth, {
  authorizeAdmin,
}).admin.saml;
