import { defineComponent } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config";

const component = defineComponent("auth");

// Mounted so the auth component can run migrations over its own tables
// (e.g. `dropHasTotp`). Consumers trigger these via `npx convex run`.
component.use(migrations);

export default component;
