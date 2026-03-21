import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../auth";

export const { configure, get, resolveSignIn, validate } = sso(auth).oidc;
