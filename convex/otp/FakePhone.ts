import phone from "@robelest/convex-auth/providers/Phone";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

export function fakePhone(options: { id?: string } = {}) {
  return phone({
    id: options.id ?? "fake-phone",
    async generateVerificationToken() {
      return "123456";
    },
    async sendVerificationRequest({ identifier: phone, token }, ctx) {
      if (phone === undefined) {
        throw new Error("`phone` param is missing for fake-phone");
      }
      await ctx.runAction(internal.otp.FakePhone.message, {
        to: phone,
        code: token,
      });
    },
  });
}

export const message = internalAction({
  args: {
    to: v.string(),
    code: v.optional(v.string()),
  },
  handler: async (_ctx, { to, code }) => {
    if (code === undefined) {
      throw new Error("Code is required");
    }
    void to;
    void code;
  },
});
