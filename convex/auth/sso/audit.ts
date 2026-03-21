import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../auth";

export const { record, list } = sso(auth).audit;
