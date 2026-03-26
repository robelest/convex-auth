import type { AuthSession, ConvexTransport, TotpClient } from "../core/types";

type TotpDeps = {
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
export function createTotpClient(deps: TotpDeps): TotpClient {
  const { proxy, convex, requireApiRefs, proxyFetch, setTokenAndMaybeWait } =
    deps;

  return {
    setup: async (opts?: {
      name?: string;
      accountName?: string;
    }): Promise<{
      uri: string;
      secret: string;
      verifier: string;
      totpId: string;
    }> => {
      const params: Record<string, any> = { flow: "setup" };
      if (opts?.name) params.name = opts.name;
      if (opts?.accountName) params.accountName = opts.accountName;

      if (proxy) {
        const result = await proxyFetch({
          action: "auth:signIn",
          args: { provider: "totp", params },
        });
        return {
          uri: result.totpSetup.uri,
          secret: result.totpSetup.secret,
          verifier: result.verifier,
          totpId: result.totpSetup.totpId,
        };
      }

      const result = await convex.action(requireApiRefs().signIn, {
        provider: "totp",
        params,
      });
      return {
        uri: result.totpSetup.uri,
        secret: result.totpSetup.secret,
        verifier: result.verifier,
        totpId: result.totpSetup.totpId,
      };
    },

    confirm: async (opts: {
      code: string;
      verifier: string;
      totpId: string;
    }): Promise<void> => {
      const params: Record<string, any> = {
        flow: "confirm",
        code: opts.code,
        totpId: opts.totpId,
      };

      if (proxy) {
        const result = await proxyFetch({
          action: "auth:signIn",
          args: { provider: "totp", params, verifier: opts.verifier },
        });
        if (result.tokens) {
          await setTokenAndMaybeWait({
            shouldStore: false,
            tokens:
              result.tokens === null ? null : { token: result.tokens.token },
            waitForHandshake: true,
            context: { provider: "totp", flow: "confirm" },
          });
        }
        return;
      }

      const result = await convex.action(requireApiRefs().signIn, {
        provider: "totp",
        params,
        verifier: opts.verifier,
      });
      if (result.tokens) {
        await setTokenAndMaybeWait({
          shouldStore: true,
          tokens: (result.tokens as AuthSession | null) ?? null,
          waitForHandshake: true,
          context: { provider: "totp", flow: "confirm" },
        });
      }
    },

    verify: async (opts: { code: string; verifier: string }): Promise<void> => {
      const params: Record<string, any> = {
        flow: "verify",
        code: opts.code,
      };

      if (proxy) {
        const result = await proxyFetch({
          action: "auth:signIn",
          args: { provider: "totp", params, verifier: opts.verifier },
        });
        if (result.tokens) {
          await setTokenAndMaybeWait({
            shouldStore: false,
            tokens:
              result.tokens === null ? null : { token: result.tokens.token },
            waitForHandshake: true,
            context: { provider: "totp", flow: "verify" },
          });
        }
        return;
      }

      const result = await convex.action(requireApiRefs().signIn, {
        provider: "totp",
        params,
        verifier: opts.verifier,
      });
      if (result.tokens) {
        await setTokenAndMaybeWait({
          shouldStore: true,
          tokens: (result.tokens as AuthSession | null) ?? null,
          waitForHandshake: true,
          context: { provider: "totp", flow: "verify" },
        });
      }
    },
  };
}
