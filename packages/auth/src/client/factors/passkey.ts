import { Fx } from "@robelest/fx";

import type {
  AuthSession,
  ConvexTransport,
  PasskeyClient,
  SignInActionResult,
  SignInResult,
} from "../core/types";
import { base64urlDecode, base64urlEncode } from "../runtime/browser";

type PasskeyDeps = {
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
export function createPasskeyClient(deps: PasskeyDeps): PasskeyClient {
  const { proxy, convex, requireApiRefs, proxyFetch, setTokenAndMaybeWait } =
    deps;

  const handleSignedInResult = async (
    result: SignInActionResult,
    flow: string,
  ): Promise<SignInResult> => {
    return Fx.run(
      Fx.match(result, result.kind, {
        signedIn: (signedInResult) =>
          Fx.promise(async () => {
            const signingIn = await setTokenAndMaybeWait(
              proxy
                ? {
                    shouldStore: false as const,
                    tokens:
                      signedInResult.tokens === null
                        ? null
                        : { token: signedInResult.tokens.token },
                    waitForHandshake: true,
                    context: { provider: "passkey", flow },
                  }
                : {
                    shouldStore: true as const,
                    tokens: signedInResult.tokens,
                    waitForHandshake: true,
                    context: { provider: "passkey", flow },
                  },
            );
            return signingIn
              ? ({ kind: "signedIn" as const } as SignInResult)
              : ({ kind: "started" as const } as SignInResult);
          }),
        redirect: () => Fx.succeed({ kind: "started" as const }),
        started: () => Fx.succeed({ kind: "started" as const }),
        passkeyOptions: () => Fx.succeed({ kind: "started" as const }),
        totpRequired: () => Fx.succeed({ kind: "started" as const }),
        totpSetup: () => Fx.succeed({ kind: "started" as const }),
        deviceCode: () => Fx.succeed({ kind: "started" as const }),
      }),
    );
  };

  return {
    isSupported: (): boolean => {
      return (
        typeof window !== "undefined" &&
        typeof window.PublicKeyCredential !== "undefined"
      );
    },

    isAutofillSupported: async (): Promise<boolean> => {
      if (typeof window === "undefined") return false;
      if (typeof window.PublicKeyCredential === "undefined") return false;
      if (
        typeof (window.PublicKeyCredential as any)
          .isConditionalMediationAvailable !== "function"
      ) {
        return false;
      }
      return (
        window.PublicKeyCredential as any
      ).isConditionalMediationAvailable();
    },

    register: async (opts?: {
      name?: string;
      email?: string;
      userName?: string;
      userDisplayName?: string;
    }): Promise<SignInResult> => {
      const phase1Params = {
        flow: "registerOptions",
        email: opts?.email,
        userName: opts?.userName,
        userDisplayName: opts?.userDisplayName,
      };

      let phase1Result: SignInActionResult;
      if (proxy) {
        phase1Result = (await proxyFetch({
          action: "auth:signIn",
          args: { provider: "passkey", params: phase1Params },
        })) as SignInActionResult;
      } else {
        phase1Result = (await convex.action(requireApiRefs().signIn, {
          provider: "passkey",
          params: phase1Params,
        })) as SignInActionResult;
      }

      if (phase1Result.kind !== "passkeyOptions") {
        throw new Error("Server did not return passkey registration options");
      }

      const options = phase1Result.options;
      const createOptions: CredentialCreationOptions = {
        publicKey: {
          rp: options.rp,
          user: {
            id: base64urlDecode(options.user.id).buffer as ArrayBuffer,
            name: options.user.name,
            displayName: options.user.displayName,
          },
          challenge: base64urlDecode(options.challenge).buffer as ArrayBuffer,
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          attestation: options.attestation,
          authenticatorSelection: options.authenticatorSelection,
          excludeCredentials: (options.excludeCredentials ?? []).map(
            (cred: any) => ({
              type: cred.type ?? "public-key",
              id: base64urlDecode(cred.id).buffer as ArrayBuffer,
              transports: cred.transports,
            }),
          ),
        },
      };

      const credential = (await navigator.credentials.create(
        createOptions,
      )) as PublicKeyCredential | null;
      if (!credential) {
        throw new Error("Passkey registration was cancelled");
      }

      const response = credential.response as AuthenticatorAttestationResponse;
      const transports =
        typeof response.getTransports === "function"
          ? response.getTransports()
          : undefined;

      const phase2Params = {
        flow: "registerVerify",
        clientDataJSON: base64urlEncode(response.clientDataJSON),
        attestationObject: base64urlEncode(response.attestationObject),
        transports,
        passkeyName: opts?.name,
        email: opts?.email,
      };

      let phase2Result: SignInActionResult;
      if (proxy) {
        phase2Result = (await proxyFetch({
          action: "auth:signIn",
          args: {
            provider: "passkey",
            params: phase2Params,
            verifier: phase1Result.verifier,
          },
        })) as SignInActionResult;
      } else {
        phase2Result = (await convex.action(requireApiRefs().signIn, {
          provider: "passkey",
          params: phase2Params,
          verifier: phase1Result.verifier,
        })) as SignInActionResult;
      }

      return handleSignedInResult(phase2Result, "registerVerify");
    },

    authenticate: async (opts?: {
      email?: string;
      autofill?: boolean;
    }): Promise<SignInResult> => {
      const phase1Params = {
        flow: "authOptions",
        email: opts?.email,
      };

      let phase1Result: SignInActionResult;
      if (proxy) {
        phase1Result = (await proxyFetch({
          action: "auth:signIn",
          args: { provider: "passkey", params: phase1Params },
        })) as SignInActionResult;
      } else {
        phase1Result = (await convex.action(requireApiRefs().signIn, {
          provider: "passkey",
          params: phase1Params,
        })) as SignInActionResult;
      }

      if (phase1Result.kind !== "passkeyOptions") {
        throw new Error("Server did not return passkey authentication options");
      }

      const options = phase1Result.options;
      const getOptions: CredentialRequestOptions = {
        publicKey: {
          challenge: base64urlDecode(options.challenge).buffer as ArrayBuffer,
          timeout: options.timeout,
          rpId: options.rpId,
          userVerification: options.userVerification,
          allowCredentials: (options.allowCredentials ?? []).map(
            (cred: any) => ({
              type: cred.type ?? "public-key",
              id: base64urlDecode(cred.id).buffer as ArrayBuffer,
              transports: cred.transports,
            }),
          ),
        },
        ...(opts?.autofill ? { mediation: "conditional" as any } : {}),
      };

      const credential = (await navigator.credentials.get(
        getOptions,
      )) as PublicKeyCredential | null;
      if (!credential) {
        throw new Error("Passkey authentication was cancelled");
      }

      const response = credential.response as AuthenticatorAssertionResponse;
      const phase2Params = {
        flow: "authVerify",
        credentialId: base64urlEncode(credential.rawId),
        clientDataJSON: base64urlEncode(response.clientDataJSON),
        authenticatorData: base64urlEncode(response.authenticatorData),
        signature: base64urlEncode(response.signature),
      };

      let phase2Result: SignInActionResult;
      if (proxy) {
        phase2Result = (await proxyFetch({
          action: "auth:signIn",
          args: {
            provider: "passkey",
            params: phase2Params,
            verifier: phase1Result.verifier,
          },
        })) as SignInActionResult;
      } else {
        phase2Result = (await convex.action(requireApiRefs().signIn, {
          provider: "passkey",
          params: phase2Params,
          verifier: phase1Result.verifier,
        })) as SignInActionResult;
      }

      return handleSignedInResult(phase2Result, "authVerify");
    },
  };
}
