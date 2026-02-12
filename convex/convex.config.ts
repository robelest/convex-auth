import { defineApp } from "convex/server";
import auth from "@convex-dev/auth/convex.config";
import resend from "@convex-dev/resend/convex.config";

const app = defineApp();

app.use(auth);
app.use(resend);

export default app;
