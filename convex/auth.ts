import { INVALID_PASSWORD } from "./errors.js";
import github from "@auth/core/providers/github";
import google from "@auth/core/providers/google";
import resend from "@auth/core/providers/resend";
import apple from "@auth/core/providers/apple";
import anonymous from "@robelest/convex-auth/providers/anonymous";
import password from "@robelest/convex-auth/providers/password";
import { ConvexError } from "convex/values";
import { Auth } from "@robelest/convex-auth/component";
import { resendOtp } from "./otp/ResendOTP";
import { fakePhone } from "./otp/FakePhone";
import { twilioOtp } from "./otp/TwilioOTP";
import { twilioVerify } from "./otp/TwilioVerify";
import { resendOtpPasswordReset } from "./passwordReset/ResendOTPPasswordReset";
import { DataModel } from "./_generated/dataModel.js";
import { components } from "./_generated/api";


export const { auth, signIn, signOut, store } = Auth({
  component: components.auth,
  providers: [
    
  fakePhone,
  fakePhone({ id: "fake-phone-2" }),
  github,
  google,
  apple({
    clientSecret: process.env.AUTH_APPLE_SECRET!,
    client: {
      token_endpoint_auth_method: "client_secret_post",
    },
    profile: undefined,
  }),
  resend({
    from: process.env.AUTH_EMAIL ?? "My App <onboarding@resend.dev>",
  }),
  resendOtp,
  twilioOtp,
  twilioVerify,
  password,
  anonymous,
    password<DataModel>({
      id: "password-custom",
      profile(params, _ctx) {
        return {
          email: params.email as string,
          favoriteColor: params.favoriteColor as string,
        };
      },
      validatePasswordRequirements: (passwordValue: string) => {
        if (
          !passwordValue ||
          passwordValue.length < 6 ||
          !/\d/.test(passwordValue) ||
          !/[a-z]/.test(passwordValue) ||
          !/[A-Z]/.test(passwordValue)
        ) {
          throw new ConvexError(INVALID_PASSWORD);
        }
      },
    }),
    password({ id: "password-with-reset", reset: resendOtpPasswordReset }),
    password({
      id: "password-code",
      reset: resendOtpPasswordReset,
      verify: resendOtp,
    }),
    password({ id: "password-link", verify: resend }),
  ],
});
