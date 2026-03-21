import { sso } from "@robelest/convex-auth/server";

import { auth } from "../../auth";

export const {
  create,
  get,
  getByGroup,
  getByDomain,
  list,
  update,
  remove,
  status,
} = sso(auth).connection;
