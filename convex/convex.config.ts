import resend from "@convex-dev/resend/convex.config";
import auth from "@robelest/convex-auth/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();

app.use(auth);
app.use(resend);

export default app;
