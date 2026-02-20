import { Google } from "arctic";
import { Resend } from "@convex-dev/resend";
import { OAuth } from "@robelest/convex-auth/providers";
import anonymous from "@robelest/convex-auth/providers/anonymous";
import device from "@robelest/convex-auth/providers/device";
import passkey from "@robelest/convex-auth/providers/passkey";
import password from "@robelest/convex-auth/providers/password";
import totp from "@robelest/convex-auth/providers/totp";
import { Auth } from "@robelest/convex-auth/component";
import { components } from "./_generated/api";

const resend = new Resend(components.resend, {
  testMode: false,
});

const auth = new Auth(components.auth, {
  providers: [
    OAuth(
      new Google(
        process.env.GOOGLE_CLIENT_ID!,
        process.env.GOOGLE_CLIENT_SECRET!,
        process.env.CONVEX_SITE_URL + "/api/auth/callback/google",
      ),
      { scopes: ["openid", "profile", "email"] },
    ),
    password,
    passkey,
    totp({ issuer: "ConvexAuth Example" }),
    anonymous,
    device({
      verificationUri: process.env.APP_URL
        ? `${process.env.APP_URL}/device`
        : "http://localhost:3000/device",
    }),
  ],
  email: {
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
  },
});

export { auth };
export const { signIn, signOut, store } = auth;
