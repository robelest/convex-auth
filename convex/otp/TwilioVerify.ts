import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { internal } from "../_generated/api";
import { DataModel } from "../_generated/dataModel";

export function TwilioVerify() {
  return ConvexCredentials<DataModel>({
    id: "twilio",
    authorize: async (params, ctx) => {
      if (params.phone === undefined) {
        throw new Error("`phone` param is missing for Twilio");
      }
      return await ctx.runAction(internal.otp.TwilioSDK.verify, {
        phone: params.phone as string,
        code: params.code as string | undefined,
      });
    },
  });
}
