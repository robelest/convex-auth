import { Passkey, type PasskeyCreateRequest, type PasskeyGetRequest } from "react-native-passkey";

import type {
  ClientAdapterDeps,
  PasskeyClient,
  SignInActionResult,
  SignInResult,
} from "../client/core/types";

type PasskeyCredentialDescriptor = {
  type?: string;
  id: string;
  transports?: string[];
};

type PasskeyRegistrationOptions = {
  rp: {
    id?: string;
    name: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  challenge: string;
  pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
  timeout?: number;
  attestation?: "none" | "indirect" | "direct" | "enterprise";
  authenticatorSelection?: {
    authenticatorAttachment?: "platform" | "cross-platform";
    requireResidentKey?: boolean;
    residentKey?: "discouraged" | "preferred" | "required";
    userVerification?: "discouraged" | "preferred" | "required";
  };
  excludeCredentials?: PasskeyCredentialDescriptor[];
};

type PasskeyAuthenticationOptions = {
  challenge: string;
  timeout?: number;
  rpId?: string;
  userVerification?: "discouraged" | "preferred" | "required";
  allowCredentials?: PasskeyCredentialDescriptor[];
};

type NativePasskeyCredentialDescriptor = NonNullable<
  PasskeyCreateRequest["excludeCredentials"]
>[number];
type NativeAuthenticatorTransport = NonNullable<
  NativePasskeyCredentialDescriptor["transports"]
>[number];

function requireStringOption(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Server did not return required passkey option \`${name}\``);
  }
  return value;
}

function toPublicKeyCredentialDescriptors(
  credentials: PasskeyCredentialDescriptor[] | undefined,
): NativePasskeyCredentialDescriptor[] {
  return (credentials ?? []).map((cred) => ({
    type: (cred.type ?? "public-key") as "public-key",
    id: cred.id,
    ...(cred.transports === undefined
      ? null
      : { transports: cred.transports as NativeAuthenticatorTransport[] }),
  }));
}

function wrapNativePasskeyError(e: unknown, cancelMessage: string): Error {
  if (e instanceof Error) {
    if (e.message.includes("cancel") || e.message.includes("Cancel")) {
      return new Error(cancelMessage);
    }
    return e;
  }
  const message =
    typeof e === "object" && e !== null && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);
  if (message.includes("cancel") || message.includes("Cancel")) {
    return new Error(cancelMessage);
  }
  return new Error(message);
}

/** @internal */
export function createExpoPasskeyClient(deps: ClientAdapterDeps): PasskeyClient {
  const { proxy, convex, requireApiRefs, proxyFetch, setTokenAndMaybeWait } = deps;

  const handleSignedInResult = async (
    result: SignInActionResult,
    flow: string,
  ): Promise<SignInResult> => {
    if (result.kind !== "signedIn") {
      return { kind: "started" as const };
    }

    const sessionEstablished = await setTokenAndMaybeWait(
      proxy
        ? {
            shouldStore: false as const,
            tokens: result.session === null ? null : { token: result.session.token },
            waitForHandshake: true,
            context: { provider: "passkey", flow },
          }
        : {
            shouldStore: true as const,
            tokens: result.session,
            waitForHandshake: true,
            context: { provider: "passkey", flow },
          },
    );

    return sessionEstablished
      ? ({ kind: "signedIn" as const } satisfies SignInResult)
      : ({ kind: "started" as const } satisfies SignInResult);
  };

  return {
    isSupported: () => Passkey.isSupported(),
    isAutofillSupported: async () => false,
    register: async (opts?: {
      name?: string;
      email?: string;
      userName?: string;
      userDisplayName?: string;
    }): Promise<SignInResult> => {
      const phase1Params = {
        flow: "register",
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
      const createRequest: PasskeyCreateRequest = {
        challenge: options.challenge,
        rp: { ...options.rp, id: requireStringOption(options.rp.id, "rp.id") },
        user: options.user,
        pubKeyCredParams: options.pubKeyCredParams,
        timeout: options.timeout,
        attestation: options.attestation,
        authenticatorSelection: options.authenticatorSelection,
        excludeCredentials: toPublicKeyCredentialDescriptors(options.excludeCredentials),
      };

      let credential;
      try {
        credential = await Passkey.create(createRequest);
      } catch (e) {
        throw wrapNativePasskeyError(e, "Passkey registration was cancelled");
      }

      const phase2Params = {
        flow: "verify",
        clientDataJSON: credential.response.clientDataJSON,
        attestationObject: credential.response.attestationObject,
        transports: credential.response.transports,
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

      return handleSignedInResult(phase2Result, "verify");
    },
    signIn: async (opts?: { email?: string; autofill?: boolean }): Promise<SignInResult> => {
      const phase1Params = {
        flow: "signIn",
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
      const getRequest: PasskeyGetRequest = {
        challenge: options.challenge,
        timeout: options.timeout,
        rpId: requireStringOption(options.rpId, "rpId"),
        userVerification: options.userVerification,
        allowCredentials: toPublicKeyCredentialDescriptors(options.allowCredentials),
      };

      let credential;
      try {
        credential = await Passkey.get(getRequest);
      } catch (e) {
        throw wrapNativePasskeyError(e, "Passkey authentication was cancelled");
      }

      const phase2Params = {
        flow: "verify",
        credentialId: credential.rawId ?? credential.id,
        clientDataJSON: credential.response.clientDataJSON,
        authenticatorData: credential.response.authenticatorData,
        signature: credential.response.signature,
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

      return handleSignedInResult(phase2Result, "verify");
    },
  };
}
