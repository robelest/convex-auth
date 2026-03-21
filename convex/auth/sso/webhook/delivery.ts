import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../../auth";

export const { list, listReady, markDelivered, markFailed } =
  sso(auth).webhook.delivery;
