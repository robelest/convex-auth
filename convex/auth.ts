import { Google } from "arctic";
import { OAuth } from "@robelest/convex-auth/providers";
import anonymous from "@robelest/convex-auth/providers/anonymous";
import passkey from "@robelest/convex-auth/providers/passkey";
import password from "@robelest/convex-auth/providers/password";
import totp from "@robelest/convex-auth/providers/totp";
import { Auth, Portal } from "@robelest/convex-auth/component";
import { components } from "./_generated/api";

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
  ],
  email: {
    from: process.env.AUTH_EMAIL ?? "My App <onboarding@resend.dev>",
    send: async (_ctx, { from, to, subject, html }) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, html }),
      });
      if (!res.ok) {
        throw new Error(`Email send failed: ${res.status}`);
      }
    },
  },
});

export { auth };
export const { signIn, signOut, store } = auth;
export const { portalQuery, portalMutation, portalInternal } = Portal(auth);
