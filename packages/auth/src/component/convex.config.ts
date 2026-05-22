import { defineComponent } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";

const component = defineComponent("auth");

component.use(migrations);
component.use(rateLimiter);
component.use(workpool, { name: "webhookWorkpool" });

export default component;
