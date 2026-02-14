import google from "@auth/core/providers/google";
import anonymous from "@convex-dev/auth/providers/anonymous";
import passkey from "@convex-dev/auth/providers/passkey";
import password from "@convex-dev/auth/providers/password";
import totp from "@convex-dev/auth/providers/totp";
import { Auth, Portal } from "@convex-dev/auth/component";
import { components } from "./_generated/api";

const auth = new Auth(components.auth, {
  providers: [
    google,
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
