import github from "@auth/core/providers/github";
import resend from "@auth/core/providers/resend";
import anonymous from "@robelest/convex-auth/providers/anonymous";
import email from "@robelest/convex-auth/providers/email";
import passkey from "@robelest/convex-auth/providers/passkey";
import password from "@robelest/convex-auth/providers/password";
import totp from "@robelest/convex-auth/providers/totp";
import phone from "@robelest/convex-auth/providers/phone";
import { type RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { ConvexAuth, portalExports } from "@robelest/convex-auth/component";
import { components } from "./_generated/api";

const random: RandomReader = {
  read(bytes: Uint8Array) {
    crypto.getRandomValues(bytes);
  },
};

function generateOTP(length: number = 8): string {
  return generateRandomString(random, "0123456789", length);
}

const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;

async function sendEmailViaDispatch(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!CONVEX_SITE_URL) {
    throw new Error("CONVEX_SITE_URL is required to dispatch auth email");
  }
  const response = await fetch(`${CONVEX_SITE_URL}/auth-email-dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.AUTH_EMAIL_DISPATCH_SECRET
        ? {
            "x-auth-email-dispatch-secret":
              process.env.AUTH_EMAIL_DISPATCH_SECRET,
          }
        : {}),
    },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!response.ok) {
    throw new Error(
      `Could not send verification code email: ${response.status}`,
    );
  }
}

const resendOtp = email({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 20,
  async generateVerificationToken() {
    return generateOTP();
  },
  async sendVerificationRequest({
    identifier: emailAddr,
    token,
    expires,
  }: {
    identifier: string;
    token: string;
    expires: Date;
  }) {
    const hours = Math.floor((+expires - Date.now()) / (60 * 60 * 1000));
    await sendEmailViaDispatch(
      emailAddr,
      "Sign in to My App",
      `<div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
        <h1 style="font-size: 20px; margin-bottom: 16px;">Sign in to My App</h1>
        <p>Please enter the following code on the sign in page.</p>
        <div style="text-align: center; margin: 24px 0;">
          <p style="font-weight: 600;">Verification code</p>
          <p style="font-size:2.25rem;font-weight:700;letter-spacing:2px;">${token}</p>
          <div style="color: #666; margin-top: 8px;">(This code is valid for ${hours} hours)</div>
        </div>
      </div>`,
    );
  },
});

function fakePhoneProvider(id: string = "fake-phone") {
  return phone({
    id,
    async generateVerificationToken() {
      return "123456";
    },
    async sendVerificationRequest({
      identifier: _phone,
      token: _token,
    }: {
      identifier: string;
      token: string;
    }) {
      // No-op: fake phone provider for testing
    },
  });
}

const auth = new ConvexAuth(components.auth, {
  providers: [
    github,
    resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.AUTH_EMAIL ?? "My App <onboarding@resend.dev>",
    }),
    resendOtp,
    fakePhoneProvider(),
    fakePhoneProvider("fake-phone-2"),
    password,
    password({
      id: "password-code",
      verify: resendOtp,
    }),
    passkey,
    totp({ issuer: "ConvexAuth Example" }),
    anonymous,
  ],
});

export { auth };
export const { signIn, signOut, store } = auth;
export const { portalQuery, portalMutation, portalInternal } = portalExports(auth);
