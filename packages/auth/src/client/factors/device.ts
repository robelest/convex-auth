import { Fx } from "@robelest/fx";
import { ConvexError } from "convex/values";

import type {
  AuthSession,
  ConvexTransport,
  DeviceClient,
  DeviceCodeResult,
} from "../core/types";

type DeviceDeps = {
  proxy: string | undefined;
  convex: ConvexTransport;
  requireApiRefs: () => { signIn: any };
  proxyFetch: (body: Record<string, unknown>) => Promise<any>;
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
  const { proxy, convex, requireApiRefs, proxyFetch, setTokenAndMaybeWait } =
    deps;

  return {
    poll: async (opts: {
      code: DeviceCodeResult;
    }): Promise<{ ok: true } | { ok: false; expired: boolean }> => {
      const { code } = opts;
      const intervalMs = code.interval * 1000;
      const expiresAt = Date.now() + code.expiresIn * 1000;

      while (Date.now() < expiresAt) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));

        const pollResult = await Fx.run(
          Fx.from({
            ok: async () => {
              let result: any;
              const params: Record<string, any> = {
                flow: "poll",
                deviceCode: code.deviceCode,
              };

              if (proxy) {
                result = await proxyFetch({
                  action: "auth:signIn",
                  args: { provider: "device", params },
                });
              } else {
                result = await convex.action(requireApiRefs().signIn, {
                  provider: "device",
                  params,
                });
              }

              return result;
            },
            err: (e) => e,
          }).pipe(
            Fx.recover((e: unknown) => {
              const dispatch =
                e instanceof ConvexError
                  ? {
                      tag:
                        (e.data as Record<string, unknown> | undefined)
                          ?.code === "DEVICE_AUTHORIZATION_PENDING"
                          ? "continue"
                          : (e.data as Record<string, unknown> | undefined)
                                ?.code === "DEVICE_SLOW_DOWN"
                            ? "slowDown"
                            : "fatal",
                    }
                  : ({ tag: "fatal" } as const);

              return Fx.match(dispatch, dispatch.tag, {
                continue: () => Fx.succeed({ _poll: "continue" as const }),
                slowDown: () => Fx.succeed({ _poll: "slow_down" as const }),
                fatal: () => Fx.fatal(e),
              });
            }),
          ),
        );

        if ("_poll" in pollResult) {
          if (pollResult._poll === "slow_down") {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
          }
          continue;
        }

        if (pollResult.tokens) {
          if (proxy) {
            await setTokenAndMaybeWait({
              shouldStore: false,
              tokens:
                pollResult.tokens === null
                  ? null
                  : { token: pollResult.tokens.token },
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
          return { ok: true as const };
        }
      }

      return { ok: false as const, expired: true };
    },

    verify: async (opts: {
      code: string;
    }): Promise<{ ok: true } | { ok: false; message: string }> => {
      const params: Record<string, any> = {
        flow: "verify",
        userCode: opts.code,
      };

      try {
        if (proxy) {
          await proxyFetch({
            action: "auth:signIn",
            args: { provider: "device", params },
          });
        } else {
          await convex.action(requireApiRefs().signIn, {
            provider: "device",
            params,
          });
        }
        return { ok: true as const };
      } catch (e: unknown) {
        return {
          ok: false as const,
          message: e instanceof Error ? e.message : "Invalid or expired code.",
        };
      }
    },
  };
}
