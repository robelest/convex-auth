import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

export const resendOtp = Email({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 20,
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes) {
        crypto.getRandomValues(bytes);
      },
    };

    const alphabet = "0123456789";
    const length = 8;
    return generateRandomString(random, alphabet, length);
  },
  async sendVerificationRequest({ identifier: email, token, expires }) {
    const convexSiteUrl = process.env.CONVEX_SITE_URL;
    if (!convexSiteUrl) {
      throw new Error("CONVEX_SITE_URL is required to dispatch auth email");
    }
    const response = await fetch(`${convexSiteUrl}/auth-email-dispatch`, {
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
      body: JSON.stringify({
        to: email,
        subject: "Sign in to My App",
        html: `
<div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
  <h1 style="font-size: 20px; margin-bottom: 16px;">Sign in to My App</h1>
  <p>Please enter the following code on the sign in page.</p>
  <div style="text-align: center; margin: 24px 0;">
    <p style="font-weight: 600;">Verification code</p>
    <p style="font-size:2.25rem;font-weight:700;letter-spacing:2px;">${token}</p>
    <div style="color: #666; margin-top: 8px;">(This code is valid for ${Math.floor((+expires - Date.now()) / (60 * 60 * 1000))} hours)</div>
  </div>
</div>
`,
      }),
    });
    if (!response.ok) {
      throw new Error(`Could not send verification code email: ${response.status}`);
    }
  },
});
