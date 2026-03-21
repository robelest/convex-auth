import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../../auth";

export const { create, list, disable } = sso(auth).webhook.endpoint;
