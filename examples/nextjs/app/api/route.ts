import { isAuthenticated } from "@/lib/auth-server";

export async function GET() {
  const authed = await isAuthenticated();
  return Response.json(
    { someData: authed },
    { status: authed ? 200 : 403 },
  );
}
