declare module "react-native" {
  export const Platform: {
    OS: string;
  };
}

declare module "expo-auth-session" {
  export interface AuthSessionRedirectUriOptions {
    native?: string;
    scheme?: string;
    path?: string;
    isTripleSlashed?: boolean;
    queryParams?: Record<string, string>;
  }

  export function makeRedirectUri(options?: AuthSessionRedirectUriOptions): string;
}

declare module "expo-secure-store" {
  export function getItemAsync(key: string): Promise<string | null>;
  export function setItemAsync(key: string, value: string): Promise<void>;
  export function deleteItemAsync(key: string): Promise<void>;
}

declare module "expo-web-browser" {
  export type WebBrowserAuthSessionResult =
    | { type: "success"; url: string }
    | { type: "cancel" | "dismiss" | "locked" | "opened" };

  export interface AuthSessionOpenOptions {
    preferEphemeralSession?: boolean;
  }

  export function openAuthSessionAsync(
    url: string,
    redirectUrl?: string,
    options?: AuthSessionOpenOptions,
  ): Promise<WebBrowserAuthSessionResult>;
}

declare module "react-native-passkey" {
  export interface PasskeyCredentialDescriptor {
    type: "public-key";
    id: string;
    transports?: string[];
  }

  export interface PasskeyCreateRequest {
    challenge: string;
    rp: {
      id?: string;
      name: string;
    };
    user: {
      id: string;
      name: string;
      displayName: string;
    };
    pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
    timeout?: number;
    excludeCredentials?: PasskeyCredentialDescriptor[];
    authenticatorSelection?: {
      authenticatorAttachment?: "platform" | "cross-platform";
      requireResidentKey?: boolean;
      residentKey?: "discouraged" | "preferred" | "required";
      userVerification?: "discouraged" | "preferred" | "required";
    };
    attestation?: "none" | "indirect" | "direct" | "enterprise";
  }

  export interface PasskeyCreateResult {
    id: string;
    rawId: string;
    type?: string;
    response: {
      clientDataJSON: string;
      attestationObject: string;
      transports?: string[];
    };
  }

  export interface PasskeyGetRequest {
    challenge: string;
    rpId?: string;
    timeout?: number;
    allowCredentials?: PasskeyCredentialDescriptor[];
    userVerification?: "discouraged" | "preferred" | "required";
  }

  export interface PasskeyGetResult {
    id: string;
    rawId?: string;
    type?: string;
    response: {
      authenticatorData: string;
      clientDataJSON: string;
      signature: string;
    };
  }

  export const Passkey: {
    isSupported(): boolean;
    create(request: PasskeyCreateRequest): Promise<PasskeyCreateResult>;
    get(request: PasskeyGetRequest): Promise<PasskeyGetResult>;
  };
}
