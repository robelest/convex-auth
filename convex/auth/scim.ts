import { scim } from "@robelest/convex-auth/server";

import { auth } from "../auth";

export const { configure, get, getConfigByToken, validate } = scim(auth);
