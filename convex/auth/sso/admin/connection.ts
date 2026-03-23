import { sso } from "@robelest/convex-auth/server";

import { auth, authorizeAdmin } from "../../../auth";

const connection = sso(auth, { authorizeAdmin }).admin.connection;

export const { create, get, getByGroup, getByDomain, list, update, status } =
  connection;
export { deleteConnection as delete };

const deleteConnection = connection.delete;
