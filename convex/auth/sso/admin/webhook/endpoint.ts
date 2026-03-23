import { sso } from "@robelest/convex-auth/server";

import { auth, authorizeAdmin } from "../../../../auth";

export const { create, list, disable } = sso(auth, {
  authorizeAdmin,
}).admin.webhook.endpoint;
