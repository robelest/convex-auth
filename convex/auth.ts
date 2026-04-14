import { Resend } from "@convex-dev/resend";
import { createAuth } from "@robelest/convex-auth/component";
import {
  anonymous,
  device,
  email,
  google,
  passkey,
  password,
  sso,
  totp,
} from "@robelest/convex-auth/providers";

import { components } from "./_generated/api";
import { roles } from "./roles";

function maybeGoogleProvider() {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return google({ clientId, clientSecret });
}

const resend = new Resend(components.resend, {
  testMode: false,
});

const googleProvider = maybeGoogleProvider();
const auth = createAuth(components.auth, {
  providers: [
    sso(),
    ...(googleProvider ? [googleProvider] : []),
    password(),
    passkey(),
    totp({ issuer: "ConvexAuth Example" }),
    anonymous(),
    device({
      verificationUri: process.env.APP_URL
        ? `${process.env.APP_URL}/device`
        : "http://localhost:3001/device",
    }),
    email({
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
  authorization: {
    roles,
  },
});

export { auth };
export const { signIn, signOut, store } = auth;
