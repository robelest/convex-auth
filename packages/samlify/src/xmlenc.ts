import { DOMParser } from "@xmldom/xmldom";
import { BigInteger, KEYUTIL, KJUR } from "jsrsasign";
import { evaluateXPathToNodes } from "fontoxpath";

const XMLENC_NS = "http://www.w3.org/2001/04/xmlenc#";

const DATA_ALGORITHMS: {
  [key: string]: {
    mode: "AES-CBC" | "AES-GCM" | "DES-EDE3-CBC";
    keyBytes: number;
    ivBytes: number;
  };
} = {
  "http://www.w3.org/2001/04/xmlenc#aes128-cbc": {
    mode: "AES-CBC",
    keyBytes: 16,
    ivBytes: 16,
  },
  "http://www.w3.org/2001/04/xmlenc#aes256-cbc": {
    mode: "AES-CBC",
    keyBytes: 32,
    ivBytes: 16,
  },
  "http://www.w3.org/2009/xmlenc11#aes128-gcm": {
    mode: "AES-GCM",
    keyBytes: 16,
    ivBytes: 12,
  },
  "http://www.w3.org/2009/xmlenc11#aes256-gcm": {
    mode: "AES-GCM",
    keyBytes: 32,
    ivBytes: 12,
  },
  "http://www.w3.org/2001/04/xmlenc#tripledes-cbc": {
    mode: "DES-EDE3-CBC",
    keyBytes: 24,
    ivBytes: 8,
  },
};

const KEY_ALGORITHMS = {
  RSA_OAEP_MGF1P: "http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p",
  RSA_1_5: "http://www.w3.org/2001/04/xmlenc#rsa-1_5",
};

export interface EncryptAssertionOptions {
  assertionXml: string;
  publicKeyPem: string;
  certificate: string;
  encryptionAlgorithm: string;
  keyEncryptionAlgorithm: string;
}

export interface DecryptAssertionOptions {
  encryptedAssertionXml: string;
  privateKey: string | Uint8Array;
}

function selectNodes(expression: string, source: any): any[] {
  return evaluateXPathToNodes(expression, source) as any[];
}

function toUtf8String(input: string | Uint8Array): string {
  if (typeof input === "string") {
    return input;
  }
  return new TextDecoder().decode(input);
}

function hasWebCrypto(): boolean {
  return !!(
    globalThis.crypto &&
    globalThis.crypto.subtle &&
    globalThis.crypto.getRandomValues
  );
}

function getSubtleCrypto(): SubtleCrypto {
  if (!hasWebCrypto()) {
    throw new Error("ERR_WEBCRYPTO_NOT_AVAILABLE");
  }
  return globalThis.crypto.subtle;
}

function randomBytes(length: number): Uint8Array {
  if (!hasWebCrypto()) {
    throw new Error("ERR_WEBCRYPTO_NOT_AVAILABLE");
  }
  const output = new Uint8Array(length);
  globalThis.crypto.getRandomValues(output);
  return output;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function binaryStringToBytes(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes));
}

function fromBase64(input: string): Uint8Array {
  return binaryStringToBytes(atob(input.replace(/\s+/g, "")));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const part = bytes[i].toString(16);
    hex += part.length === 1 ? `0${part}` : part;
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.length % 2 === 1 ? `0${hex}` : hex;
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    out[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return out;
}

function normalizeCertificateBody(certificate: string): string {
  return certificate
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

function normalizePemContent(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
}

function pemToDer(pem: string): Uint8Array {
  return fromBase64(normalizePemContent(pem));
}

function uint8ArrayToArrayBuffer(input: Uint8Array): ArrayBuffer {
  if (input.byteOffset === 0 && input.byteLength === input.buffer.byteLength) {
    return input.buffer;
  }
  return input.buffer.slice(
    input.byteOffset,
    input.byteOffset + input.byteLength,
  );
}

async function importRsaOaepPublicKey(
  publicKeyPem: string,
): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const der = pemToDer(publicKeyPem);
  return subtle.importKey(
    "spki",
    uint8ArrayToArrayBuffer(der),
    {
      name: "RSA-OAEP",
      hash: "SHA-1",
    },
    false,
    ["encrypt"],
  );
}

async function importRsaOaepPrivateKey(
  privateKeyPem: string,
): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const keyObject = KEYUTIL.getKey(privateKeyPem);
  const pkcs8Pem = KEYUTIL.getPEM(keyObject, "PKCS8PRV");
  const der = pemToDer(pkcs8Pem);
  return subtle.importKey(
    "pkcs8",
    uint8ArrayToArrayBuffer(der),
    {
      name: "RSA-OAEP",
      hash: "SHA-1",
    },
    false,
    ["decrypt"],
  );
}

function getRsaModulusSizeInBytes(key: any): number {
  if (!key || !key.n || typeof key.n.bitLength !== "function") {
    throw new Error("ERR_INVALID_RSA_KEY");
  }
  return Math.ceil(key.n.bitLength() / 8);
}

function bigIntToSizedBytes(value: any, size: number): Uint8Array {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) {
    hex = `0${hex}`;
  }
  let bytes = hexToBytes(hex);

  if (bytes.length > size) {
    // Handle sign-extension overflow from BigInteger representation
    bytes = bytes.slice(bytes.length - size);
  }

  if (bytes.length < size) {
    const padded = new Uint8Array(size);
    padded.set(bytes, size - bytes.length);
    bytes = padded;
  }

  return bytes;
}

function rsaPkcs1v15PadEncrypt(
  message: Uint8Array,
  modulusSize: number,
): Uint8Array {
  if (message.length > modulusSize - 11) {
    throw new Error("ERR_RSA_MESSAGE_TOO_LONG");
  }

  const psLength = modulusSize - message.length - 3;
  if (psLength < 8) {
    throw new Error("ERR_RSA_PS_TOO_SHORT");
  }

  const ps = new Uint8Array(psLength);
  for (let i = 0; i < psLength; i++) {
    let value = 0;
    while (value === 0) {
      value = randomBytes(1)[0];
    }
    ps[i] = value;
  }

  const output = new Uint8Array(modulusSize);
  output[0] = 0x00;
  output[1] = 0x02;
  output.set(ps, 2);
  output[2 + psLength] = 0x00;
  output.set(message, 3 + psLength);
  return output;
}

function rsaPkcs1v15UnpadDecrypt(encoded: Uint8Array): Uint8Array {
  if (encoded.length < 11 || encoded[0] !== 0x00 || encoded[1] !== 0x02) {
    throw new Error("ERR_RSA_PKCS1_V15_BAD_PADDING");
  }

  let separator = -1;
  for (let i = 2; i < encoded.length; i++) {
    if (encoded[i] === 0x00) {
      separator = i;
      break;
    }
  }

  if (separator < 10) {
    throw new Error("ERR_RSA_PKCS1_V15_BAD_PADDING");
  }

  return encoded.slice(separator + 1);
}

function encryptRsa1_5(data: Uint8Array, publicKeyPem: string): Uint8Array {
  const publicKey = KEYUTIL.getKey(publicKeyPem) as any;
  const modulusSize = getRsaModulusSizeInBytes(publicKey);
  const padded = rsaPkcs1v15PadEncrypt(data, modulusSize);
  const m = new BigInteger(bytesToHex(padded), 16);
  const c = publicKey.doPublic(m);
  return bigIntToSizedBytes(c, modulusSize);
}

function decryptRsa1_5(
  encrypted: Uint8Array,
  privateKeyPem: string,
): Uint8Array {
  const privateKey = KEYUTIL.getKey(privateKeyPem) as any;
  const modulusSize = getRsaModulusSizeInBytes(privateKey);
  const c = new BigInteger(bytesToHex(encrypted), 16);
  const m = privateKey.doPrivate(c);
  const encoded = bigIntToSizedBytes(m, modulusSize);
  return rsaPkcs1v15UnpadDecrypt(encoded);
}

async function wrapSymmetricKey(
  symmetricKey: Uint8Array,
  publicKeyPem: string,
  keyEncryptionAlgorithm: string,
): Promise<Uint8Array> {
  if (keyEncryptionAlgorithm === KEY_ALGORITHMS.RSA_OAEP_MGF1P) {
    const subtle = getSubtleCrypto();
    const publicKey = await importRsaOaepPublicKey(publicKeyPem);
    const encrypted = await subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      uint8ArrayToArrayBuffer(symmetricKey),
    );
    return new Uint8Array(encrypted);
  }

  if (keyEncryptionAlgorithm === KEY_ALGORITHMS.RSA_1_5) {
    return encryptRsa1_5(symmetricKey, publicKeyPem);
  }

  throw new Error(
    `ERR_KEY_ENCRYPTION_ALGORITHM_NOT_SUPPORTED: ${keyEncryptionAlgorithm}`,
  );
}

async function unwrapSymmetricKey(
  encryptedKey: Uint8Array,
  privateKeyPem: string,
  keyEncryptionAlgorithm: string,
): Promise<Uint8Array> {
  if (keyEncryptionAlgorithm === KEY_ALGORITHMS.RSA_OAEP_MGF1P) {
    const subtle = getSubtleCrypto();
    const privateKey = await importRsaOaepPrivateKey(privateKeyPem);
    const decrypted = await subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      uint8ArrayToArrayBuffer(encryptedKey),
    );
    return new Uint8Array(decrypted);
  }

  if (keyEncryptionAlgorithm === KEY_ALGORITHMS.RSA_1_5) {
    return decryptRsa1_5(encryptedKey, privateKeyPem);
  }

  throw new Error(
    `ERR_KEY_ENCRYPTION_ALGORITHM_NOT_SUPPORTED: ${keyEncryptionAlgorithm}`,
  );
}

async function encryptAes(
  content: Uint8Array,
  symmetricKey: Uint8Array,
  mode: "AES-CBC" | "AES-GCM",
  iv: Uint8Array,
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const key = await subtle.importKey(
    "raw",
    uint8ArrayToArrayBuffer(symmetricKey),
    { name: mode },
    false,
    ["encrypt"],
  );
  const params =
    mode === "AES-GCM"
      ? ({ name: "AES-GCM", iv, tagLength: 128 } as AesGcmParams)
      : ({ name: "AES-CBC", iv } as AesCbcParams);

  const encrypted = await subtle.encrypt(
    params,
    key,
    uint8ArrayToArrayBuffer(content),
  );
  return new Uint8Array(encrypted);
}

async function decryptAes(
  encrypted: Uint8Array,
  symmetricKey: Uint8Array,
  mode: "AES-CBC" | "AES-GCM",
  iv: Uint8Array,
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const key = await subtle.importKey(
    "raw",
    uint8ArrayToArrayBuffer(symmetricKey),
    { name: mode },
    false,
    ["decrypt"],
  );
  const params =
    mode === "AES-GCM"
      ? ({ name: "AES-GCM", iv, tagLength: 128 } as AesGcmParams)
      : ({ name: "AES-CBC", iv } as AesCbcParams);

  const decrypted = await subtle.decrypt(
    params,
    key,
    uint8ArrayToArrayBuffer(encrypted),
  );
  return new Uint8Array(decrypted);
}

function encryptTripleDesCbc(
  content: Uint8Array,
  symmetricKey: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  const encryptedHex = KJUR.crypto.Cipher.encrypt(
    bytesToHex(content),
    bytesToHex(symmetricKey),
    "des-EDE3-CBC",
    { iv: bytesToHex(iv) },
  );
  return hexToBytes(encryptedHex);
}

function decryptTripleDesCbc(
  encrypted: Uint8Array,
  symmetricKey: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  const decryptedHex = KJUR.crypto.Cipher.decrypt(
    bytesToHex(encrypted),
    bytesToHex(symmetricKey),
    "des-EDE3-CBC",
    { iv: bytesToHex(iv) },
  );
  return hexToBytes(decryptedHex);
}

function getRequiredAttrValue(node: any, attrName: string): string {
  if (!node || !node.getAttribute) {
    throw new Error(`ERR_MISSING_XML_NODE_FOR_ATTRIBUTE: ${attrName}`);
  }
  const value = node.getAttribute(attrName);
  if (!value) {
    throw new Error(`ERR_MISSING_XML_ATTRIBUTE: ${attrName}`);
  }
  return value;
}

function getCipherValueText(node: any): string {
  const cipherNode = selectNodes(
    "./*[local-name(.)='CipherData']/*[local-name(.)='CipherValue']",
    node,
  )[0];
  if (!cipherNode || typeof cipherNode.textContent !== "string") {
    throw new Error("ERR_MISSING_CIPHER_VALUE");
  }
  return cipherNode.textContent;
}

function resolveEncryptedDataNode(doc: Document): any {
  const encryptedDataNode = selectNodes(
    "//*[local-name(.)='EncryptedData']",
    doc,
  )[0];
  if (!encryptedDataNode) {
    throw new Error("ERR_MISSING_ENCRYPTED_DATA");
  }
  return encryptedDataNode;
}

function resolveEncryptedKeyNode(
  doc: Document,
  encryptedDataNode: any,
): {
  keyEncryptionAlgorithm: string;
  encryptedKey: Uint8Array;
} {
  const keyInfoNode = selectNodes(
    "./*[local-name(.)='KeyInfo']",
    encryptedDataNode,
  )[0];
  if (!keyInfoNode) {
    throw new Error("cant find encryption algorithm");
  }

  let encryptedKeyContainer = selectNodes(
    "./*[local-name(.)='EncryptedKey']",
    keyInfoNode,
  )[0];

  if (!encryptedKeyContainer) {
    const keyRetrievalMethod = selectNodes(
      "./*[local-name(.)='RetrievalMethod']",
      keyInfoNode,
    )[0];
    const retrievalMethodUri =
      keyRetrievalMethod && keyRetrievalMethod.getAttribute
        ? keyRetrievalMethod.getAttribute("URI")
        : null;
    if (retrievalMethodUri && retrievalMethodUri.indexOf("#") === 0) {
      const keyId = retrievalMethodUri.substring(1);
      if (keyId.indexOf("'") >= 0) {
        throw new Error("ERR_INVALID_RETRIEVAL_METHOD_URI");
      }
      encryptedKeyContainer = selectNodes(
        `//*[local-name(.)='EncryptedKey' and @Id='${keyId}']`,
        doc,
      )[0];
    }
  }

  if (!encryptedKeyContainer) {
    encryptedKeyContainer = selectNodes(
      ".//*[local-name(.)='EncryptedKey']",
      keyInfoNode,
    )[0];
  }

  if (!encryptedKeyContainer) {
    throw new Error("cant find encryption algorithm");
  }

  const keyEncMethodNode =
    selectNodes(
      "./*[local-name(.)='EncryptionMethod']",
      encryptedKeyContainer,
    )[0] ||
    selectNodes(
      ".//*[local-name(.)='EncryptionMethod']",
      encryptedKeyContainer,
    )[0];

  if (!keyEncMethodNode) {
    throw new Error("cant find encryption algorithm");
  }

  const keyEncryptionAlgorithm = getRequiredAttrValue(
    keyEncMethodNode,
    "Algorithm",
  );
  const encryptedKeyNode =
    selectNodes(
      "./*[local-name(.)='CipherData']/*[local-name(.)='CipherValue']",
      encryptedKeyContainer,
    )[0] ||
    selectNodes(
      ".//*[local-name(.)='CipherData']/*[local-name(.)='CipherValue']",
      encryptedKeyContainer,
    )[0];

  if (!encryptedKeyNode || typeof encryptedKeyNode.textContent !== "string") {
    throw new Error("ERR_MISSING_ENCRYPTED_KEY");
  }

  return {
    keyEncryptionAlgorithm,
    encryptedKey: fromBase64(encryptedKeyNode.textContent),
  };
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function encryptAssertion(
  opts: EncryptAssertionOptions,
): Promise<string> {
  const {
    assertionXml,
    publicKeyPem,
    certificate,
    encryptionAlgorithm,
    keyEncryptionAlgorithm,
  } = opts;

  if (!assertionXml) {
    throw new Error("must provide content to encrypt");
  }
  if (!publicKeyPem) {
    throw new Error(
      "rsa_pub option is mandatory and you should provide a valid RSA public key",
    );
  }
  if (!certificate) {
    throw new Error(
      "pem option is mandatory and you should provide a valid x509 certificate encoded as PEM",
    );
  }

  const dataAlg = DATA_ALGORITHMS[encryptionAlgorithm];
  if (!dataAlg) {
    throw new Error(
      `encryption algorithm not supported: ${encryptionAlgorithm}`,
    );
  }

  const symmetricKey = randomBytes(dataAlg.keyBytes);
  const iv = randomBytes(dataAlg.ivBytes);
  const contentBytes = new TextEncoder().encode(assertionXml);

  let encryptedContent: Uint8Array;
  if (dataAlg.mode === "AES-CBC" || dataAlg.mode === "AES-GCM") {
    encryptedContent = await encryptAes(
      contentBytes,
      symmetricKey,
      dataAlg.mode,
      iv,
    );
  } else {
    encryptedContent = encryptTripleDesCbc(contentBytes, symmetricKey, iv);
  }

  const encryptedPayload = concatBytes(iv, encryptedContent);
  const encryptedKey = await wrapSymmetricKey(
    symmetricKey,
    publicKeyPem,
    keyEncryptionAlgorithm,
  );
  const certBody = normalizeCertificateBody(certificate);

  return (
    `<xenc:EncryptedData Type="http://www.w3.org/2001/04/xmlenc#Element" xmlns:xenc="${XMLENC_NS}">` +
    `<xenc:EncryptionMethod Algorithm="${escapeXmlText(encryptionAlgorithm)}" />` +
    `<KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    `<e:EncryptedKey xmlns:e="${XMLENC_NS}">` +
    `<e:EncryptionMethod Algorithm="${escapeXmlText(keyEncryptionAlgorithm)}">` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1" />` +
    `</e:EncryptionMethod>` +
    `<KeyInfo>` +
    `<X509Data><X509Certificate>${escapeXmlText(certBody)}</X509Certificate></X509Data>` +
    `</KeyInfo>` +
    `<e:CipherData>` +
    `<e:CipherValue>${toBase64(encryptedKey)}</e:CipherValue>` +
    `</e:CipherData>` +
    `</e:EncryptedKey>` +
    `</KeyInfo>` +
    `<xenc:CipherData>` +
    `<xenc:CipherValue>${toBase64(encryptedPayload)}</xenc:CipherValue>` +
    `</xenc:CipherData>` +
    `</xenc:EncryptedData>`
  );
}

export async function decryptAssertion(
  opts: DecryptAssertionOptions,
): Promise<string> {
  const { encryptedAssertionXml, privateKey } = opts;

  if (!encryptedAssertionXml) {
    throw new Error("must provide XML to encrypt");
  }

  const privateKeyPem = toUtf8String(privateKey);
  if (!privateKeyPem) {
    throw new Error(
      "key option is mandatory and you should provide a valid RSA private key",
    );
  }

  const doc = new DOMParser().parseFromString(encryptedAssertionXml);
  const encryptedDataNode = resolveEncryptedDataNode(doc);

  const dataEncMethodNode = selectNodes(
    "./*[local-name(.)='EncryptionMethod']",
    encryptedDataNode,
  )[0];
  const encryptionAlgorithm = getRequiredAttrValue(
    dataEncMethodNode,
    "Algorithm",
  );

  const dataAlg = DATA_ALGORITHMS[encryptionAlgorithm];
  if (!dataAlg) {
    throw new Error(
      `encryption algorithm ${encryptionAlgorithm} not supported`,
    );
  }

  const keyInfo = resolveEncryptedKeyNode(doc, encryptedDataNode);
  const keyEncryptionAlgorithm = keyInfo.keyEncryptionAlgorithm;
  const encryptedKey = keyInfo.encryptedKey;
  const symmetricKey = await unwrapSymmetricKey(
    encryptedKey,
    privateKeyPem,
    keyEncryptionAlgorithm,
  );

  const encryptedContent = fromBase64(getCipherValueText(encryptedDataNode));

  if (encryptedContent.length < dataAlg.ivBytes) {
    throw new Error("ERR_INVALID_ENCRYPTED_CONTENT");
  }

  const iv = encryptedContent.slice(0, dataAlg.ivBytes);
  const payload = encryptedContent.slice(dataAlg.ivBytes);

  let decrypted: Uint8Array;
  if (dataAlg.mode === "AES-CBC" || dataAlg.mode === "AES-GCM") {
    decrypted = await decryptAes(payload, symmetricKey, dataAlg.mode, iv);
  } else {
    decrypted = decryptTripleDesCbc(payload, symmetricKey, iv);
  }

  const result = new TextDecoder().decode(decrypted);
  if (!result) {
    throw new Error("ERR_UNDEFINED_ENCRYPTED_ASSERTION");
  }

  return result;
}
