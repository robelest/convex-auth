import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../auth";

export const { emit } = sso(auth).webhook;
