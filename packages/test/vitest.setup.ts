process.env.AUTH_APPLE_SECRET ??= "test-apple-secret";
process.env.RESEND_API_KEY ??= "test-resend-key";
process.env.AUTH_EMAIL ??= "My App <onboarding@resend.dev>";
process.env.CONVEX_SITE_URL ??= "https://test-123.convex.site";
process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";

const DIRECT_CALL_WARNING =
  "Convex functions should not directly call other Convex functions.";
const EXPECTED_ERROR_SUBSTRINGS = [
  "Invalid refresh token",
  "Invalid verification code",
  "Too many failed attempts to verify code for this email",
  "Expired refresh token",
  "Refresh token used outside of reuse window",
];

const originalWarn = console.warn;
const originalError = console.error;

console.warn = (...args: unknown[]) => {
  const [firstArg] = args;
  if (typeof firstArg === "string" && firstArg.includes(DIRECT_CALL_WARNING)) {
    return;
  }
  originalWarn(...(args as Parameters<typeof console.warn>));
};

console.error = (...args: unknown[]) => {
  const joined = args
    .map((arg) => (typeof arg === "string" ? arg : ""))
    .join(" ");
  if (EXPECTED_ERROR_SUBSTRINGS.some((s) => joined.includes(s))) {
    return;
  }
  originalError(...(args as Parameters<typeof console.error>));
};
