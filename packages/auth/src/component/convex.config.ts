import { defineComponent } from "convex/server";
import selfHosting from "@convex-dev/self-hosting/convex.config";

const component = defineComponent("auth");

component.use(selfHosting);

export default component;
