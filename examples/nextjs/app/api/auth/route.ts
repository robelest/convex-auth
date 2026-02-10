import { proxyAuthRoute } from "@/lib/auth-server";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return proxyAuthRoute(request);
}
