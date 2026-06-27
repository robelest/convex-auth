import { createHash, randomBytes } from "node:crypto";

function base64url(input: Buffer) {
  return input.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function createPkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" as const };
}

export function createAuthorizationUrl(args: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: readonly string[];
  state?: string;
}) {
  const pkce = createPkcePair();
  const url = new URL("/oauth2/authorize", args.issuer.replace(/\/$/, ""));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", args.scopes.join(" "));
  url.searchParams.set("resource", args.resource);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", pkce.method);
  if (args.state !== undefined) {
    url.searchParams.set("state", args.state);
  }
  return { url, codeVerifier: pkce.verifier };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const issuer = process.env.MCP_AUTH_ISSUER ?? "https://example.com/auth";
  const resource = process.env.MCP_RESOURCE ?? "https://example.com/mcp";
  const clientId = process.env.MCP_CLIENT_ID ?? "oc_replace_me";
  const redirectUri = process.env.MCP_REDIRECT_URI ?? "http://localhost:8787/callback";
  const { url, codeVerifier } = createAuthorizationUrl({
    issuer,
    clientId,
    redirectUri,
    resource,
    scopes: [
      "projects.read",
      "members.read",
      "projects.create",
      "issues.create",
      "issues.edit",
      "issues.delete",
      "comments.create",
      "comments.delete",
      "members.manage",
    ],
    state: randomBytes(16).toString("hex"),
  });

  console.log("Open this authorization URL:");
  console.log(url.toString());
  console.log("");
  console.log("Keep this code_verifier for the token exchange:");
  console.log(codeVerifier);
}
