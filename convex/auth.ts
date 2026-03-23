import { Resend } from "@convex-dev/resend";
import { createAuth } from "@robelest/convex-auth/component";
import { Email, OAuth, SSO } from "@robelest/convex-auth/providers";
import { Anonymous } from "@robelest/convex-auth/providers/anonymous";
import { Device } from "@robelest/convex-auth/providers/device";
import { Passkey } from "@robelest/convex-auth/providers/passkey";
import { Password } from "@robelest/convex-auth/providers/password";
import { Totp } from "@robelest/convex-auth/providers/totp";
import { Google } from "arctic";

import { components } from "./_generated/api";

function maybeGoogleProvider() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const convexSiteUrl = process.env.CONVEX_SITE_URL;
  if (!clientId || !clientSecret || !convexSiteUrl) {
    return null;
  }
  return OAuth(
    new Google(
      clientId,
      clientSecret,
      `${convexSiteUrl}/api/auth/callback/google`,
    ),
    { scopes: ["openid", "profile", "email"] },
  );
}

const resend = new Resend(components.resend, {
  testMode: false,
});

const googleProvider = maybeGoogleProvider();

const auth = createAuth(components.auth, {
  providers: [
    new SSO(),
    ...(googleProvider ? [googleProvider] : []),
    new Password(),
    new Passkey(),
    new Totp({ issuer: "ConvexAuth Example" }),
    new Anonymous(),
    new Device({
      verificationUri: process.env.APP_URL
        ? `${process.env.APP_URL}/device`
        : "http://localhost:3000/device",
    }),
    new Email({
      from: process.env.AUTH_EMAIL ?? "My App <onboarding@resend.dev>",
      send: async (ctx, params) => {
        await resend.sendEmailManually(
          ctx,
          {
            from: params.from,
            to: params.to,
            subject: params.subject,
          },
          async () => {
            const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: params.from,
                to: params.to,
                subject: params.subject,
                html: params.html,
              }),
            });
            if (!res.ok) {
              throw new Error(`Email send failed: ${res.status}`);
            }
            const payload = (await res.json()) as { id?: string };
            return payload.id ?? "sent";
          },
        );
      },
    }),
  ],
});

export async function authorizeAdmin(
  ctx: any,
  input: { userId: string; resolvedGroupId: string | null },
) {
  if (input.resolvedGroupId === null) {
    return;
  }
  await auth.member.require(ctx, {
    userId: input.userId,
    groupId: input.resolvedGroupId,
    roles: ["admin"],
  });
}

export { auth };
export const { signIn, signOut, store } = auth;
