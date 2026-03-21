import { httpRouter } from "convex/server";

import { auth } from "./auth";

const http = httpRouter();

auth.http.add(http);

export default http;
