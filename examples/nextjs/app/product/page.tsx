import { Chat } from "@/app/product/Chat/Chat";
import { ChatIntro } from "@/app/product/Chat/ChatIntro";
import { UserMenu } from "@/components/UserMenu";
import { convexAuthToken } from "@/lib/auth-server";
import { api } from "@convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProductPage() {
  const viewer = await fetchQuery(
    api.users.viewer,
    {},
    { token: await convexAuthToken() ?? undefined },
  );
  if (viewer === null) {
    redirect("/signin");
  }
  return (
    <main className="flex max-h-screen grow flex-col overflow-hidden">
      <div className="flex items-start justify-between border-b p-4">
        <ChatIntro />
        <UserMenu>{viewer.name}</UserMenu>
      </div>
      <Chat viewer={viewer._id} />
    </main>
  );
}
