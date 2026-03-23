import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../auth";

export const { signIn, metadata } = sso(auth).client;
