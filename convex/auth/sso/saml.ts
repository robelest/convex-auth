import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../auth";

export const { configure, metadata, validate } = sso(auth).saml;
