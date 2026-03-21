import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../../auth";

export const { list, set } = sso(auth).connection.domain;
