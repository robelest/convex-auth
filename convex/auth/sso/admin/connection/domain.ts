import { sso } from "@robelest/convex-auth/server";

import { auth, authorizeAdmin } from "../../../../auth";

export const { list, validate, set } = sso(auth, {
  authorizeAdmin,
}).admin.connection.domain;
