import { Google } from "arctic";
import { Resend } from "@convex-dev/resend";
import { OAuth } from "@robelest/convex-auth/providers";
import { Anonymous } from "@robelest/convex-auth/providers/anonymous";
import { Device } from "@robelest/convex-auth/providers/device";
import { Passkey } from "@robelest/convex-auth/providers/passkey";
import { Password } from "@robelest/convex-auth/providers/password";
import { Totp } from "@robelest/convex-auth/providers/totp";
import { Auth } from "@robelest/convex-auth/component";
import { components } from "./_generated/api";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const resend = new Resend(components.resend, {
  testMode: false,
});

const auth = new Auth(components.auth, {
  providers: [
    OAuth(
      new Google(
        requireEnv("GOOGLE_CLIENT_ID"),
        requireEnv("GOOGLE_CLIENT_SECRET"),
        `${requireEnv("CONVEX_SITE_URL")}/api/auth/callback/google`,
      ),
      { scopes: ["openid", "profile", "email"] },
    ),
    new Password(),
    new Passkey(),
    new Totp({ issuer: "ConvexAuth Example" }),
    new Anonymous(),
    new Device({
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
