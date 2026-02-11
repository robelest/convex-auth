import credentials from "@robelest/convex-auth/providers/credentials";
import { internal } from "../_generated/api";
import { DataModel } from "../_generated/dataModel";

export function twilioVerify() {
  return credentials<DataModel>({
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
