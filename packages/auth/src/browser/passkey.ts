import type {
  ClientAdapterDeps,
  PasskeyClient,
  SignInActionResult,
  SignInResult,
} from "../client/core/types";
import { base64urlDecode, base64urlEncode } from "./runtime";

type ConditionalMediationCredential = typeof PublicKeyCredential & {
  isConditionalMediationAvailable?: () => Promise<boolean>;
};

type PasskeyCredentialDescriptor = {
  type?: string;
  id: string;
  transports?: AuthenticatorTransport[];
};

type PasskeyRegistrationOptions = {
  rp: PublicKeyCredentialRpEntity;
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  challenge: string;
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: PasskeyCredentialDescriptor[];
};

type PasskeyAuthenticationOptions = {
  challenge: string;
  timeout?: number;
  rpId?: string;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: PasskeyCredentialDescriptor[];
};

/** @internal */
export function createPasskeyClient(deps: ClientAdapterDeps): PasskeyClient {
  const { proxy, convex, requireApiRefs, proxyFetch, setTokenAndMaybeWait } =
    deps;

  const handleSignedInResult = async (
    result: SignInActionResult,
    flow: string,
  ): Promise<SignInResult> => {
    if (result.kind !== "signedIn") {
      return { kind: "started" as const };
    }

    const signingIn = await setTokenAndMaybeWait(
      proxy
        ? {
            shouldStore: false as const,
            tokens:
              result.tokens === null ? null : { token: result.tokens.token },
            waitForHandshake: true,
            context: { provider: "passkey", flow },
          }
        : {
            shouldStore: true as const,
            tokens: result.tokens,
            waitForHandshake: true,
            context: { provider: "passkey", flow },
          },
    );

    return signingIn
      ? ({ kind: "signedIn" as const } as SignInResult)
      : ({ kind: "started" as const } as SignInResult);
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
      const credential =
        window.PublicKeyCredential as ConditionalMediationCredential;
      if (typeof credential.isConditionalMediationAvailable !== "function") {
        return false;
      }
      return credential.isConditionalMediationAvailable();
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

      const options = phase1Result.options as PasskeyRegistrationOptions;
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
            (cred: PasskeyCredentialDescriptor) => ({
              type: (cred.type ?? "public-key") as "public-key",
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

      const options = phase1Result.options as PasskeyAuthenticationOptions;
      const getOptions: CredentialRequestOptions = {
        publicKey: {
          challenge: base64urlDecode(options.challenge).buffer as ArrayBuffer,
          timeout: options.timeout,
          rpId: options.rpId,
          userVerification: options.userVerification,
          allowCredentials: (options.allowCredentials ?? []).map(
            (cred: PasskeyCredentialDescriptor) => ({
              type: (cred.type ?? "public-key") as "public-key",
              id: base64urlDecode(cred.id).buffer as ArrayBuffer,
              transports: cred.transports,
            }),
          ),
        },
        ...(opts?.autofill
          ? ({
              mediation: "conditional" as CredentialMediationRequirement,
            } as const)
          : {}),
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
