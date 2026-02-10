import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { sendAuthEmail } from "./emailDispatch";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/auth-email-dispatch",
  method: "POST",
  handler: sendAuthEmail,
});

export default http;
