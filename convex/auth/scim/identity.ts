import { scim } from "@robelest/convex-auth/server";

import { auth } from "../../auth";

export const { get, upsert } = scim(auth).identity;
