/**
 * Shared entity-setting defaults used by both createIdentityProvider and createServiceProvider.
 */

import * as uuid from "uuid";
import {
  SignatureAlgorithm,
  DataEncryptionAlgorithm,
  KeyEncryptionAlgorithm,
  SigningOrder,
} from "./constants";

/** Default entity settings merged under caller-supplied IdP/SP settings. */
export const DEFAULT_ENTITY_SETTINGS = {
  wantLogoutResponseSigned: false,
  messageSigningOrder: SigningOrder.SIGN_THEN_ENCRYPT,
  wantLogoutRequestSigned: false,
  allowCreate: false,
  isAssertionEncrypted: false,
  requestSignatureAlgorithm: SignatureAlgorithm.RSA_SHA256,
  dataEncryptionAlgorithm: DataEncryptionAlgorithm.AES_256,
  keyEncryptionAlgorithm: KeyEncryptionAlgorithm.RSA_OAEP_MGF1P,
  generateID: (): string => "_" + uuid.v4(),
  relayState: "",
} as const;
