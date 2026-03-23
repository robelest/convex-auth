import { sso } from "@robelest/convex-auth/server";

import { auth, authorizeAdmin } from "../../../auth";

export const { list } = sso(auth, {
  authorizeAdmin,
}).admin.audit;
