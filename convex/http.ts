import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.http.add(http);

// ---------------------------------------------------------------------------
// POST /api/messages — send a chat message authenticated via API key
//
// Bearer token extraction, verification, CORS, and error handling are all
// handled automatically by auth.http.route(). The handler receives
// ctx.key.userId after successful verification.
// ---------------------------------------------------------------------------

auth.http.route(http, {
  path: "/api/messages",
  method: "POST",
  handler: async (ctx, request) => {
    let body: string;
    try {
      const json = await request.json();
      body = json.body;
      if (!body || typeof body !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing 'body' string field" }),
          { status: 400 },
        );
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400 },
      );
    }

    await ctx.runMutation(internal.messages.sendAsUser, {
      userId: ctx.key.userId,
      body,
    });

    return { success: true };
  },
});

export default http;
