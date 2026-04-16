import { createAuthContext } from "@robelest/convex-auth/core";

import { components } from "../_generated/api";
import { roles } from "../roles";

export const auth = createAuthContext(components.auth, {
  authorization: { roles },
});
