import { httpAction } from "./_generated/server";
import { resend } from "./resend";

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

export const sendAuthEmail = httpAction(async (ctx, req) => {
  const expectedSecret = process.env.AUTH_EMAIL_DISPATCH_SECRET;
  if (expectedSecret !== undefined) {
    const receivedSecret = req.headers.get("x-auth-email-dispatch-secret");
    if (receivedSecret !== expectedSecret) {
      return unauthorized();
    }
  }

  const payload = (await req.json()) as {
    to: string;
    subject: string;
    html: string;
  };

  await resend.sendEmail(ctx, {
    from: process.env.AUTH_EMAIL ?? "My App <onboarding@resend.dev>",
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });

  return new Response(null, { status: 202 });
});
