import { LoginResponseTemplate } from "./compat";

export type BinaryLike = string | Uint8Array;

export { IdentityProvider as IdentityProviderConstructor } from "./entity-idp";
export { IdpMetadata as IdentityProviderMetadata } from "./metadata-idp";

export { ServiceProvider as ServiceProviderConstructor } from "./entity-sp";
export { SpMetadata as ServiceProviderMetadata } from "./metadata-sp";

export type MetadataFile = BinaryLike;

type SSOService = {
  isDefault?: boolean;
  Binding: string;
  Location: string;
};

export interface MetadataIdpOptions {
  entityID?: string;
  signingCert?: BinaryLike | BinaryLike[];
  encryptCert?: BinaryLike | BinaryLike[];
  wantAuthnRequestsSigned?: boolean;
  nameIDFormat?: string[];
  singleSignOnService?: SSOService[];
  singleLogoutService?: SSOService[];
  requestSignatureAlgorithm?: string;
}

export type MetadataIdpConstructor = MetadataIdpOptions | MetadataFile;

export interface MetadataSpOptions {
  entityID?: string;
  signingCert?: BinaryLike | BinaryLike[];
  encryptCert?: BinaryLike | BinaryLike[];
  authnRequestsSigned?: boolean;
  wantAssertionsSigned?: boolean;
  wantMessageSigned?: boolean;
  signatureConfig?: { [key: string]: any };
  nameIDFormat?: string[];
  singleSignOnService?: SSOService[];
  singleLogoutService?: SSOService[];
  assertionConsumerService?: SSOService[];
  elementsOrder?: string[];
}

export type MetadataSpConstructor = MetadataSpOptions | MetadataFile;

export type EntitySetting = ServiceProviderSettings & IdentityProviderSettings;

export interface SignatureConfig {
  prefix?: string;
  location?: {
    reference?: string;
    action?: "append" | "prepend" | "before" | "after";
  };
}

export interface SAMLDocumentTemplate {
  context?: string;
}

export type ServiceProviderSettings = {
  metadata?: BinaryLike;
  entityID?: string;
  authnRequestsSigned?: boolean;
  wantAssertionsSigned?: boolean;
  wantMessageSigned?: boolean;
  wantLogoutResponseSigned?: boolean;
  wantLogoutRequestSigned?: boolean;
  privateKey?: BinaryLike;
  privateKeyPass?: string;
  isAssertionEncrypted?: boolean;
  requestSignatureAlgorithm?: string;
  encPrivateKey?: BinaryLike;
  encPrivateKeyPass?: BinaryLike;
  assertionConsumerService?: SSOService[];
  singleLogoutService?: SSOService[];
  signatureConfig?: SignatureConfig;
  loginRequestTemplate?: SAMLDocumentTemplate;
  logoutRequestTemplate?: SAMLDocumentTemplate;
  signingCert?: BinaryLike | BinaryLike[];
  encryptCert?: BinaryLike | BinaryLike[];
  transformationAlgorithms?: string[];
  nameIDFormat?: string[];
  allowCreate?: boolean;
  // will be deprecated soon
  relayState?: string;
  // https://github.com/tngan/samlify/issues/337
  clockDrifts?: [number, number];
};

export type IdentityProviderSettings = {
  metadata?: BinaryLike;

  /** signature algorithm */
  requestSignatureAlgorithm?: string;

  /** template of login response */
  loginResponseTemplate?: LoginResponseTemplate;

  /** template of logout request */
  logoutRequestTemplate?: SAMLDocumentTemplate;

  /** customized function used for generating request ID */
  generateID?: () => string;

  entityID?: string;
  privateKey?: BinaryLike;
  privateKeyPass?: string;
  signingCert?: BinaryLike | BinaryLike[];
  encryptCert?: BinaryLike | BinaryLike[];
  nameIDFormat?: string[];
  singleSignOnService?: SSOService[];
  singleLogoutService?: SSOService[];
  isAssertionEncrypted?: boolean;
  encPrivateKey?: BinaryLike;
  encPrivateKeyPass?: string;
  messageSigningOrder?: string;
  wantLogoutRequestSigned?: boolean;
  wantLogoutResponseSigned?: boolean;
  wantAuthnRequestsSigned?: boolean;
  wantLogoutRequestSignedResponseSigned?: boolean;
  tagPrefix?: { [key: string]: string };
};
