import { ConvexError } from "convex/values";

import type {
  AuthSession,
  ConvexTransport,
  DeviceClient,
  DeviceCodeResult,
  SignInActionResult,
  SignInApiRef,
} from "../core/types";

function isSignedInResult(
  result: SignInActionResult,
): result is Extract<SignInActionResult, { kind: "signedIn" }> {
  return result.kind === "signedIn";
}

type DeviceDeps = {
  proxy: string | undefined;
  convex: ConvexTransport;
  requireApiRefs: () => SignInApiRef;
  proxyFetch: (body: Record<string, unknown>) => Promise<unknown>;
  setTokenAndMaybeWait: (
    args:
      | {
          shouldStore: true;
          tokens: AuthSession | null;
          waitForHandshake: boolean;
          context: { provider?: string; flow: string };
        }
      | {
          shouldStore: false;
          tokens: { token: string } | null;
          waitForHandshake: boolean;
          context: { provider?: string; flow: string };
        },
  ) => Promise<boolean>;
};

/** @internal */
export function createDeviceClient(deps: DeviceDeps): DeviceClient {
  const { proxy, convex, requireApiRefs, proxyFetch, setTokenAndMaybeWait } = deps;

  const requestDeviceSignIn = async (
    params: Record<string, unknown>,
  ): Promise<SignInActionResult> => {
    return (
      proxy
        ? await proxyFetch({
            action: "auth:signIn",
            args: { provider: "device", params },
          })
        : await convex.action(requireApiRefs().signIn, {
            provider: "device",
            params,
          })
    ) as SignInActionResult;
  };

  return {
    poll: async (opts: { code: DeviceCodeResult }): Promise<void> => {
      const { code } = opts;
      const intervalMs = code.interval * 1000;
      const expiresAt = Date.now() + code.expiresIn * 1000;

      while (Date.now() < expiresAt) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));

        const params: Record<string, unknown> = {
          flow: "poll",
          deviceCode: code.deviceCode,
        };

        let pollResult: SignInActionResult | null;
        try {
          pollResult = await requestDeviceSignIn(params);
        } catch (error) {
          if (error instanceof ConvexError) {
            const errorCode = (error.data as Record<string, unknown> | undefined)?.code;
            if (errorCode === "DEVICE_AUTHORIZATION_PENDING") {
              continue;
            }
            if (errorCode === "DEVICE_SLOW_DOWN") {
              await new Promise((resolve) => setTimeout(resolve, intervalMs));
              continue;
            }
          }
          throw error;
        }

        if (pollResult === null) {
          continue;
        }

        if (isSignedInResult(pollResult) && pollResult.tokens) {
          if (proxy) {
            await setTokenAndMaybeWait({
              shouldStore: false,
              tokens: pollResult.tokens === null ? null : { token: pollResult.tokens.token },
              waitForHandshake: true,
              context: { provider: "device", flow: "poll" },
            });
          } else {
            await setTokenAndMaybeWait({
              shouldStore: true,
              tokens: (pollResult.tokens as AuthSession | null) ?? null,
              waitForHandshake: true,
              context: { provider: "device", flow: "poll" },
            });
          }
          return;
        }
      }

      throw new ConvexError({
        code: "DEVICE_CODE_EXPIRED",
        message: "Device code expired before authorization was completed.",
      });
    },

    verify: async (opts: { code: string }): Promise<void> => {
      const params: Record<string, unknown> = {
        flow: "verify",
        userCode: opts.code,
      };

      try {
        await requestDeviceSignIn(params);
      } catch (error) {
        throw new ConvexError({
          code: "DEVICE_AUTHORIZATION_FAILED",
          message: error instanceof Error ? error.message : "Invalid or expired code.",
        });
      }
    },
  };
}
