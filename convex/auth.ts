import { Google } from "arctic";
import { Resend } from "@convex-dev/resend";
import { Device, OAuth } from "@robelest/convex-auth/providers";
import anonymous from "@robelest/convex-auth/providers/anonymous";
import passkey from "@robelest/convex-auth/providers/passkey";
import password from "@robelest/convex-auth/providers/password";
import totp from "@robelest/convex-auth/providers/totp";
import { Auth, Portal } from "@robelest/convex-auth/component";
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
    new Device({
      verificationUri: process.env.APP_URL
        ? `${process.env.APP_URL}/device`
        : "http://localhost:3000/device",
    }),
  ],
  email: {
    from: process.env.AUTH_EMAIL ?? "My App <onboarding@resend.dev>",
    send: (ctx, params) => resend.sendEmail(ctx, params),
  },
});

export { auth };
export const { signIn, signOut, store } = auth;
export const { portalQuery, portalMutation, portalInternal } = Portal(auth);
