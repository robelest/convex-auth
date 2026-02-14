import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// ---------------------------------------------------------------------------
// POST /api/messages — send a chat message authenticated via API key
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

http.route({
  path: "/api/messages",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

http.route({
  path: "/api/messages",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const headers = { ...corsHeaders, "Content-Type": "application/json" };

    // 1. Extract Bearer token
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers },
      );
    }
    const rawKey = authHeader.slice(7);

    // 2. Verify API key
    let userId: string;
    try {
      const result = await auth.key.verify(ctx, rawKey);
      userId = result.userId;
    } catch (error: any) {
      return new Response(
        JSON.stringify({ error: error.message ?? "Invalid API key" }),
        { status: 403, headers },
      );
    }

    // 3. Parse request body
    let body: string;
    try {
      const json = await request.json();
      body = json.body;
      if (!body || typeof body !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing 'body' string field" }),
          { status: 400, headers },
        );
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers },
      );
    }

    // 4. Insert message via internal mutation (bypasses session auth)
    await ctx.runMutation(internal.messages.sendAsUser, { userId, body });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers },
    );
  }),
});

export default http;
