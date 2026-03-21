import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../auth";

export const { get, update, validate } = sso(auth).policy;
