import { DOMParser } from "@xmldom/xmldom";
import { C14nNode, C14nProcessOptions, getTransformByAlgorithm } from "./c14n";
import { b64tohex, hextob64, KJUR, KEYUTIL, Signature } from "jsrsasign";
import { evaluateXPathToNodes } from "fontoxpath";

export type BinaryLike = string | Uint8Array;

export interface MessageSignerOptions {
  octetString: string;
  privateKey: BinaryLike;
  signingScheme: string;
  isBase64Output: boolean;
}

export interface MessageVerifierOptions {
  octetString: string;
  signature: BinaryLike;
  publicKey: string;
  signingScheme: string;
}

export interface ConstructMessageSignatureOptions {
  octetString: string;
  key: string;
  passphrase?: string;
  isBase64?: boolean;
  signingAlgorithm?: string;
  nrsaAliasMapping: { [key: string]: string };
  defaultSignatureAlgorithm: string;
  readPrivateKey: (
    keyString: BinaryLike,
    passphrase: string | undefined,
    isOutputString?: boolean,
  ) => BinaryLike;
  signMessage: (opts: MessageSignerOptions) => string | Uint8Array;
}

export interface VerifyMessageSignatureOptions {
  octetString: string;
  signature: BinaryLike;
  signCert: string;
  verifyAlgorithm?: string;
  nrsaAliasMapping: { [key: string]: string };
  defaultSignatureAlgorithm: string;
  getPublicKeyPemFromCertificate: (x509Certificate: string) => string;
  verifyMessage: (opts: MessageVerifierOptions) => boolean;
}

export interface ConstructSamlSignatureOptions {
  rawSamlMessage: string;
  referenceTagXPath?: string;
  privateKey: string;
  privateKeyPass?: string;
  signatureAlgorithm: string;
  signingCert: BinaryLike;
  isBase64Output?: boolean;
  signatureConfig?: any;
  isMessageSigned?: boolean;
  transformationAlgorithms?: string[];
  getDigestMethod: (sigAlg: string) => string | undefined;
  getKeyInfo: (
    x509Certificate: string,
    signatureConfig?: any,
  ) => { getKeyInfo: () => string; getKey: () => string };
  readPrivateKey: (
    keyString: BinaryLike,
    passphrase: string | undefined,
    isOutputString?: boolean,
  ) => BinaryLike;
  base64Encode: (message: string | number[]) => string;
}

interface XmlSignatureAlgorithm {
  getSignature: (signedInfo: string, privateKey: string) => string;
  verifySignature: (
    material: string,
    key: string,
    signatureValue: string,
  ) => boolean;
  getAlgorithmName: () => string;
}

interface XmlHashAlgorithm {
  getHash: (xml: string) => string;
  getAlgorithmName: () => string;
}

interface XmlReference {
  xpath?: string;
  transforms: string[];
  digestAlgorithm: string;
  uri?: string;
  digestValue?: string;
  inclusiveNamespacesPrefixList: string[];
  isEmptyUri: boolean;
  ancestorNamespaces?: Array<{ prefix: string; namespaceURI: string }>;
  signedReference?: string;
  validationError?: Error;
}

interface ComputeSignatureOptions {
  prefix?: string;
  attrs?: { [key: string]: string };
  location?: {
    reference?: string;
    action?: "append" | "prepend" | "before" | "after";
  };
  existingPrefixes?: { [key: string]: string };
}

function selectNodes(expression: string, source: any): Node[] {
  return evaluateXPathToNodes(expression, source) as Node[];
}

function toUtf8String(input: BinaryLike): string {
  if (typeof input === "string") {
    return input;
  }
  return new TextDecoder().decode(input);
}

function normalizePem(pem: string): string {
  return `${(
    pem
      .trim()
      .replace(/(\r\n|\r)/g, "\n")
      .match(/.{1,64}/g) || []
  ).join("\n")}\n`;
}

function derToPem(derBase64: string, pemLabel: string): string {
  const cleaned = derBase64.replace(/(\r\n|\r|\n)/g, "").trim();
  const pem = `-----BEGIN ${pemLabel}-----\n${cleaned}\n-----END ${pemLabel}-----`;
  return normalizePem(pem);
}

function normalizeCertificateBody(raw: string): string {
  return raw
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

function mapSchemeToJsrsasignAlg(scheme: string): string {
  const normalized = scheme.toLowerCase();
  if (normalized.indexOf("sha256") >= 0) {
    return "SHA256withRSA";
  }
  if (normalized.indexOf("sha512") >= 0) {
    return "SHA512withRSA";
  }
  return "SHA1withRSA";
}

function isElementNode(node: any): node is Element {
  return !!node && node.nodeType === 1;
}

function isAttributeNode(node: any): node is Attr {
  return !!node && node.nodeType === 2;
}

function isTextNode(node: any): node is Text {
  return !!node && node.nodeType === 3;
}

function findChildren(node: any, localName: string): Element[] {
  const element = node.documentElement || node;
  const res: Element[] = [];
  if (!element || !element.childNodes) {
    return res;
  }
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i] as any;
    if (isElementNode(child) && child.localName === localName) {
      res.push(child);
    }
  }
  return res;
}

function findAttr(
  element: Element,
  localName: string,
  namespace?: string,
): Attr | null {
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    if (
      attr.localName === localName &&
      (namespace == null ||
        attr.namespaceURI === namespace ||
        (!attr.namespaceURI && element.namespaceURI === namespace))
    ) {
      return attr;
    }
  }
  return null;
}

function isArrayHasLength(input: any[]): boolean {
  return Array.isArray(input) && input.length > 0;
}

function getElementNamespaceDeclarations(
  node: Element,
): Array<{ prefix: string; namespaceURI: string }> {
  const out: Array<{ prefix: string; namespaceURI: string }> = [];
  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes[i];
    if (attr.nodeName.search(/^xmlns:?/) !== -1) {
      out.push({
        prefix: attr.nodeName.replace(/^xmlns:?/, ""),
        namespaceURI: attr.nodeValue || "",
      });
    }
  }
  return out;
}

function findAncestorNs(
  doc: Document,
  docSubsetXpath?: string,
): Array<{ prefix: string; namespaceURI: string }> {
  if (!docSubsetXpath) {
    return [];
  }
  const docSubset = selectNodes(docSubsetXpath, doc) as any[];
  if (!isArrayHasLength(docSubset)) {
    return [];
  }
  const first = docSubset[0] as any;
  if (!isElementNode(first)) {
    throw new Error("Document subset must be list of elements");
  }

  const nsList: Array<{ prefix: string; namespaceURI: string }> = [];
  let parent = first.parentNode as any;
  while (parent && isElementNode(parent)) {
    nsList.push(...getElementNamespaceDeclarations(parent));
    parent = parent.parentNode;
  }

  const unique: Array<{ prefix: string; namespaceURI: string }> = [];
  for (const entry of nsList) {
    if (!unique.find((v) => v.prefix === entry.prefix)) {
      unique.push(entry);
    }
  }

  const subsetPrefix = (() => {
    for (let i = 0; i < first.attributes.length; i++) {
      const nodeName = first.attributes[i].nodeName;
      if (nodeName.search(/^xmlns:?/) !== -1) {
        return nodeName.replace(/^xmlns:?/, "");
      }
    }
    return first.prefix || "";
  })();

  return unique.filter((v) => v.prefix !== subsetPrefix);
}

class Sha1 implements XmlHashAlgorithm {
  getHash(xml: string): string {
    const md = new KJUR.crypto.MessageDigest({ alg: "sha1" });
    md.updateString(xml);
    return hextob64(md.digest());
  }

  getAlgorithmName(): string {
    return "http://www.w3.org/2000/09/xmldsig#sha1";
  }
}

class Sha256 implements XmlHashAlgorithm {
  getHash(xml: string): string {
    const md = new KJUR.crypto.MessageDigest({ alg: "sha256" });
    md.updateString(xml);
    return hextob64(md.digest());
  }

  getAlgorithmName(): string {
    return "http://www.w3.org/2001/04/xmlenc#sha256";
  }
}

class Sha512 implements XmlHashAlgorithm {
  getHash(xml: string): string {
    const md = new KJUR.crypto.MessageDigest({ alg: "sha512" });
    md.updateString(xml);
    return hextob64(md.digest());
  }

  getAlgorithmName(): string {
    return "http://www.w3.org/2001/04/xmlenc#sha512";
  }
}

class RsaSha1 implements XmlSignatureAlgorithm {
  getSignature(signedInfo: string, privateKey: string): string {
    const signer = new Signature({ alg: "SHA1withRSA" });
    signer.init(privateKey);
    signer.updateString(signedInfo);
    return hextob64(signer.sign());
  }

  verifySignature(
    material: string,
    key: string,
    signatureValue: string,
  ): boolean {
    const verifier = new Signature({ alg: "SHA1withRSA" });
    verifier.init(key);
    verifier.updateString(material);
    return verifier.verify(b64tohex(signatureValue));
  }

  getAlgorithmName(): string {
    return "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
  }
}

class RsaSha256 implements XmlSignatureAlgorithm {
  getSignature(signedInfo: string, privateKey: string): string {
    const signer = new Signature({ alg: "SHA256withRSA" });
    signer.init(privateKey);
    signer.updateString(signedInfo);
    return hextob64(signer.sign());
  }

  verifySignature(
    material: string,
    key: string,
    signatureValue: string,
  ): boolean {
    const verifier = new Signature({ alg: "SHA256withRSA" });
    verifier.init(key);
    verifier.updateString(material);
    return verifier.verify(b64tohex(signatureValue));
  }

  getAlgorithmName(): string {
    return "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  }
}

class RsaSha512 implements XmlSignatureAlgorithm {
  getSignature(signedInfo: string, privateKey: string): string {
    const signer = new Signature({ alg: "SHA512withRSA" });
    signer.init(privateKey);
    signer.updateString(signedInfo);
    return hextob64(signer.sign());
  }

  verifySignature(
    material: string,
    key: string,
    signatureValue: string,
  ): boolean {
    const verifier = new Signature({ alg: "SHA512withRSA" });
    verifier.init(key);
    verifier.updateString(material);
    return verifier.verify(b64tohex(signatureValue));
  }

  getAlgorithmName(): string {
    return "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512";
  }
}

export class SignedXml {
  signatureAlgorithm: string | undefined;
  canonicalizationAlgorithm: string | undefined;
  inclusiveNamespacesPrefixList: string[] = [];
  keyInfoAttributes: { [key: string]: string } = {};
  getKeyInfoContent = SignedXml.getKeyInfoContent;
  getCertFromKeyInfo = SignedXml.getCertFromKeyInfo;

  private id = 0;
  private signedXml = "";
  private signatureXml = "";
  private signatureNode: Node | null = null;
  private signatureValue = "";
  private originalXmlWithIds = "";
  private keyInfo: Node | null = null;
  private references: XmlReference[] = [];
  private signedReferences: string[] = [];

  private idAttributes = ["Id", "ID", "id"];
  private privateKey: string | undefined;
  publicCert: string | undefined;

  private HashAlgorithms: { [key: string]: new () => XmlHashAlgorithm } = {
    "http://www.w3.org/2000/09/xmldsig#sha1": Sha1,
    "http://www.w3.org/2001/04/xmlenc#sha256": Sha256,
    "http://www.w3.org/2001/04/xmlenc#sha512": Sha512,
  };

  private SignatureAlgorithms: {
    [key: string]: new () => XmlSignatureAlgorithm;
  } = {
    "http://www.w3.org/2000/09/xmldsig#rsa-sha1": RsaSha1,
    "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256": RsaSha256,
    "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512": RsaSha512,
  };

  static defaultNsForPrefix: { [key: string]: string } = {
    ds: "http://www.w3.org/2000/09/xmldsig#",
  };

  static getKeyInfoContent({
    publicCert,
    prefix,
  }: {
    publicCert?: string;
    prefix?: string;
  }): string | null {
    if (!publicCert) {
      return null;
    }
    const currentPrefix = prefix ? `${prefix}:` : "";
    const certBody = normalizeCertificateBody(publicCert);
    if (!certBody) {
      return null;
    }
    return `<${currentPrefix}X509Data><${currentPrefix}X509Certificate>${certBody}</${currentPrefix}X509Certificate></${currentPrefix}X509Data>`;
  }

  static getCertFromKeyInfo(keyInfo: Node | null): string | null {
    if (!keyInfo) {
      return null;
    }
    const certNode = selectNodes(
      ".//*[local-name(.)='X509Certificate']",
      keyInfo,
    )[0] as any;
    if (certNode && typeof certNode.textContent === "string") {
      return derToPem(certNode.textContent, "CERTIFICATE");
    }
    return null;
  }

  addReference({
    xpath,
    transforms,
    digestAlgorithm,
    uri = "",
    digestValue,
    inclusiveNamespacesPrefixList = [],
    isEmptyUri = false,
  }: {
    xpath?: string;
    transforms: string[];
    digestAlgorithm: string;
    uri?: string;
    digestValue?: string;
    inclusiveNamespacesPrefixList?: string[];
    isEmptyUri?: boolean;
  }) {
    if (!digestAlgorithm) {
      throw new Error("digestAlgorithm is required");
    }
    if (!isArrayHasLength(transforms)) {
      throw new Error(
        "transforms must contain at least one transform algorithm",
      );
    }

    this.references.push({
      xpath,
      transforms,
      digestAlgorithm,
      uri,
      digestValue,
      inclusiveNamespacesPrefixList,
      isEmptyUri,
    });
  }

  getSignedReferences(): string[] {
    return [...this.signedReferences];
  }

  private findHashAlgorithm(name: string): XmlHashAlgorithm {
    const Algo = this.HashAlgorithms[name];
    if (!Algo) {
      throw new Error(`hash algorithm '${name}' is not supported`);
    }
    return new Algo();
  }

  private findSignatureAlgorithm(name?: string): XmlSignatureAlgorithm {
    if (!name) {
      throw new Error("signatureAlgorithm is required");
    }
    const Algo = this.SignatureAlgorithms[name];
    if (!Algo) {
      throw new Error(`signature algorithm '${name}' is not supported`);
    }
    return new Algo();
  }

  private getCanonXml(
    transforms: string[],
    node: Node,
    options: C14nProcessOptions = {},
  ): string {
    options.defaultNsForPrefix =
      options.defaultNsForPrefix || SignedXml.defaultNsForPrefix;
    options.signatureNode = this.signatureNode as any;

    const canonXml = node.cloneNode(true) as C14nNode;
    let transformed: C14nNode | string = canonXml;

    transforms.forEach((transformName) => {
      if (typeof transformed !== "string") {
        const transform = getTransformByAlgorithm(transformName) as any;
        transformed = transform.process(transformed, options);
      }
    });

    return transformed.toString();
  }

  private ensureHasId(node: Element): string {
    for (const idAttr of this.idAttributes) {
      const attr = findAttr(node, idAttr);
      if (attr) {
        return attr.value;
      }
    }
    const id = `_${this.id++}`;
    node.setAttribute("Id", id);
    return id;
  }

  private getCanonReferenceXml(
    doc: Document,
    ref: XmlReference,
    node: Node,
  ): string {
    if (Array.isArray(ref.transforms)) {
      ref.ancestorNamespaces = findAncestorNs(doc, ref.xpath);
    }

    const c14nOptions: C14nProcessOptions = {
      inclusiveNamespacesPrefixList: ref.inclusiveNamespacesPrefixList,
      ancestorNamespaces: ref.ancestorNamespaces,
    };

    return this.getCanonXml(ref.transforms, node, c14nOptions);
  }

  private getCanonSignedInfoXml(doc: Document): string {
    if (this.signatureNode == null) {
      throw new Error("No signature found.");
    }
    if (typeof this.canonicalizationAlgorithm !== "string") {
      throw new Error(
        "Missing canonicalizationAlgorithm when trying to get signed info for XML",
      );
    }
    const signedInfo = findChildren(this.signatureNode, "SignedInfo");
    if (signedInfo.length === 0) {
      throw new Error("could not find SignedInfo element in the message");
    }
    if (signedInfo.length > 1) {
      throw new Error(
        "could not get canonicalized signed info for a signature that contains multiple SignedInfo nodes",
      );
    }

    const ancestorNamespaces = findAncestorNs(
      doc,
      "//*[local-name()='SignedInfo']",
    );
    return this.getCanonXml([this.canonicalizationAlgorithm], signedInfo[0], {
      ancestorNamespaces,
    });
  }

  private createReferences(doc: Document, prefix?: string): string {
    const currentPrefix = prefix ? `${prefix}:` : "";
    let res = "";

    for (const ref of this.references) {
      const nodes = selectNodes(ref.xpath || "", doc);
      if (!isArrayHasLength(nodes)) {
        throw new Error(
          `the following xpath cannot be signed because it was not found: ${ref.xpath}`,
        );
      }

      for (const node of nodes) {
        if (ref.isEmptyUri) {
          res += `<${currentPrefix}Reference URI="">`;
        } else {
          const id = this.ensureHasId(node as Element);
          ref.uri = id;
          res += `<${currentPrefix}Reference URI="#${id}">`;
        }

        res += `<${currentPrefix}Transforms>`;
        for (const trans of ref.transforms || []) {
          const transform = getTransformByAlgorithm(trans) as any;
          res += `<${currentPrefix}Transform Algorithm="${transform.getAlgorithmName()}"`;
          if (isArrayHasLength(ref.inclusiveNamespacesPrefixList)) {
            res += ">";
            res += `<InclusiveNamespaces PrefixList="${ref.inclusiveNamespacesPrefixList.join(" ")}" xmlns="${transform.getAlgorithmName()}"/>`;
            res += `</${currentPrefix}Transform>`;
          } else {
            res += " />";
          }
        }

        const canonXml = this.getCanonReferenceXml(doc, ref, node);
        const digestAlgorithm = this.findHashAlgorithm(ref.digestAlgorithm);
        res +=
          `</${currentPrefix}Transforms>` +
          `<${currentPrefix}DigestMethod Algorithm="${digestAlgorithm.getAlgorithmName()}" />` +
          `<${currentPrefix}DigestValue>${digestAlgorithm.getHash(canonXml)}</${currentPrefix}DigestValue>` +
          `</${currentPrefix}Reference>`;
      }
    }

    return res;
  }

  private createSignedInfo(doc: Document, prefix?: string): string {
    if (typeof this.canonicalizationAlgorithm !== "string") {
      throw new Error(
        "Missing canonicalizationAlgorithm when trying to create signed info for XML",
      );
    }

    const transform = getTransformByAlgorithm(
      this.canonicalizationAlgorithm,
    ) as any;
    const algo = this.findSignatureAlgorithm(this.signatureAlgorithm);
    const currentPrefix = prefix ? `${prefix}:` : "";

    let res = `<${currentPrefix}SignedInfo>`;
    res += `<${currentPrefix}CanonicalizationMethod Algorithm="${transform.getAlgorithmName()}"`;
    if (isArrayHasLength(this.inclusiveNamespacesPrefixList)) {
      res += ">";
      res += `<InclusiveNamespaces PrefixList="${this.inclusiveNamespacesPrefixList.join(" ")}" xmlns="${transform.getAlgorithmName()}"/>`;
      res += `</${currentPrefix}CanonicalizationMethod>`;
    } else {
      res += " />";
    }
    res += `<${currentPrefix}SignatureMethod Algorithm="${algo.getAlgorithmName()}" />`;
    res += this.createReferences(doc, prefix);
    res += `</${currentPrefix}SignedInfo>`;
    return res;
  }

  private createSignature(prefix?: string): Node {
    let xmlNsAttr = "xmlns";
    let currentPrefix = "";
    if (prefix) {
      xmlNsAttr += `:${prefix}`;
      currentPrefix = `${prefix}:`;
    }

    const signatureValueXml = `<${currentPrefix}SignatureValue>${this.signatureValue}</${currentPrefix}SignatureValue>`;
    const wrapper = `<${currentPrefix}Signature ${xmlNsAttr}="http://www.w3.org/2000/09/xmldsig#">${signatureValueXml}</${currentPrefix}Signature>`;
    const doc = new DOMParser().parseFromString(wrapper);
    return doc.documentElement.firstChild as Node;
  }

  private calculateSignatureValue(doc: Document): void {
    const signedInfoCanon = this.getCanonSignedInfoXml(doc);
    const signer = this.findSignatureAlgorithm(this.signatureAlgorithm);
    if (this.privateKey == null) {
      throw new Error("Private key is required to compute signature");
    }
    this.signatureValue = signer.getSignature(signedInfoCanon, this.privateKey);
  }

  private getKeyInfo(prefix?: string): string {
    const currentPrefix = prefix ? `${prefix}:` : "";
    let keyInfoAttrs = "";
    if (this.keyInfoAttributes) {
      Object.keys(this.keyInfoAttributes).forEach((name) => {
        keyInfoAttrs += ` ${name}="${this.keyInfoAttributes[name]}"`;
      });
    }
    const keyInfoContent = this.getKeyInfoContent({
      publicCert: this.publicCert,
      prefix,
    });
    if (keyInfoAttrs || keyInfoContent) {
      return `<${currentPrefix}KeyInfo${keyInfoAttrs}>${keyInfoContent || ""}</${currentPrefix}KeyInfo>`;
    }
    return "";
  }

  computeSignature(xml: string, options?: ComputeSignatureOptions) {
    options = options || {};
    const doc = new DOMParser().parseFromString(xml);

    let xmlNsAttr = "xmlns";
    const signatureAttrs: string[] = [];
    const validActions = ["append", "prepend", "before", "after"];
    const prefix = options.prefix;
    const attrs = options.attrs || {};
    const location = options.location || {};
    const existingPrefixes = options.existingPrefixes || {};

    location.reference = location.reference || "/*";
    location.action = location.action || "append";

    if (validActions.indexOf(location.action) === -1) {
      throw new Error(
        `location.action option has an invalid action: ${location.action}, must be any of the following values: ${validActions.join(", ")}`,
      );
    }

    let currentPrefix = "";
    if (prefix) {
      xmlNsAttr += `:${prefix}`;
      currentPrefix = `${prefix}:`;
    }

    Object.keys(attrs).forEach((name) => {
      if (name !== "xmlns" && name !== xmlNsAttr) {
        signatureAttrs.push(`${name}="${attrs[name]}"`);
      }
    });

    signatureAttrs.push(`${xmlNsAttr}="http://www.w3.org/2000/09/xmldsig#"`);

    let signatureXml = `<${currentPrefix}Signature ${signatureAttrs.join(" ")}>`;
    signatureXml += this.createSignedInfo(doc, prefix);
    signatureXml += this.getKeyInfo(prefix);
    signatureXml += `</${currentPrefix}Signature>`;

    this.originalXmlWithIds = doc.toString();

    let existingPrefixesString = "";
    Object.keys(existingPrefixes).forEach((key) => {
      existingPrefixesString += `xmlns:${key}="${existingPrefixes[key]}" `;
    });

    const dummySignatureWrapper = `<Dummy ${existingPrefixesString}>${signatureXml}</Dummy>`;
    const nodeXml = new DOMParser().parseFromString(dummySignatureWrapper);
    const signatureDoc = nodeXml.documentElement.firstChild as Node;

    const referenceNode = selectNodes(location.reference, doc)[0];
    if (!referenceNode) {
      throw new Error(
        `the following xpath cannot be used because it was not found: ${location.reference}`,
      );
    }

    if (location.action === "append") {
      referenceNode.appendChild(signatureDoc);
    } else if (location.action === "prepend") {
      referenceNode.insertBefore(signatureDoc, referenceNode.firstChild);
    } else if (location.action === "before") {
      if (!referenceNode.parentNode) {
        throw new Error(
          "`location.reference` refers to the root node (by default), so we cannot insert `before`",
        );
      }
      referenceNode.parentNode.insertBefore(signatureDoc, referenceNode);
    } else if (location.action === "after") {
      if (!referenceNode.parentNode) {
        throw new Error(
          "`location.reference` refers to the root node (by default), so we cannot insert `after`",
        );
      }
      referenceNode.parentNode.insertBefore(
        signatureDoc,
        referenceNode.nextSibling,
      );
    }

    this.signatureNode = signatureDoc;

    const signedInfoNodes = findChildren(this.signatureNode, "SignedInfo");
    if (signedInfoNodes.length === 0) {
      throw new Error("could not find SignedInfo element in the message");
    }

    this.calculateSignatureValue(doc);
    signatureDoc.insertBefore(
      this.createSignature(prefix),
      signedInfoNodes[0].nextSibling,
    );
    this.signatureXml = signatureDoc.toString();
    this.signedXml = doc.toString();
  }

  loadReference(refNode: Node) {
    let nodes = findChildren(refNode, "DigestMethod");
    if (nodes.length === 0) {
      throw new Error(
        `could not find DigestMethod in reference ${refNode.toString()}`,
      );
    }
    const digestAlgoNode = nodes[0];
    const digestAttr = findAttr(digestAlgoNode, "Algorithm");
    if (!digestAttr) {
      throw new Error(
        `could not find Algorithm attribute in node ${digestAlgoNode.toString()}`,
      );
    }
    const digestAlgo = digestAttr.value;

    nodes = findChildren(refNode, "DigestValue");
    if (nodes.length === 0) {
      throw new Error(
        `could not find DigestValue node in reference ${refNode.toString()}`,
      );
    }
    if (nodes.length > 1) {
      throw new Error(
        `could not load reference for a node that contains multiple DigestValue nodes: ${refNode.toString()}`,
      );
    }

    const digestValue = nodes[0].textContent || "";
    if (!digestValue) {
      throw new Error(
        `could not find the value of DigestValue in ${refNode.toString()}`,
      );
    }

    const transforms: string[] = [];
    let inclusiveNamespacesPrefixList: string[] = [];

    nodes = findChildren(refNode, "Transforms");
    if (nodes.length !== 0) {
      const transformsNode = nodes[0];
      const transformsAll = findChildren(transformsNode, "Transform");
      for (const transform of transformsAll) {
        const transformAttr = findAttr(transform, "Algorithm");
        if (transformAttr) {
          transforms.push(transformAttr.value);
        }
      }

      const lastTransform = transformsAll[transformsAll.length - 1];
      if (lastTransform) {
        const inclusiveNamespaces = findChildren(
          lastTransform,
          "InclusiveNamespaces",
        );
        if (isArrayHasLength(inclusiveNamespaces)) {
          const values: string[] = [];
          inclusiveNamespaces.forEach((namespaceNode) => {
            const prefixList = namespaceNode.getAttribute("PrefixList") || "";
            prefixList.split(" ").forEach((v) => {
              if (v.length > 0) {
                values.push(v);
              }
            });
          });
          inclusiveNamespacesPrefixList = values;
        }
      }
    }

    if (
      transforms.length === 0 ||
      transforms[transforms.length - 1] ===
        "http://www.w3.org/2000/09/xmldsig#enveloped-signature"
    ) {
      transforms.push("http://www.w3.org/2001/10/xml-exc-c14n#");
    }

    const refUri = isElementNode(refNode) ? refNode.getAttribute("URI") : null;
    this.addReference({
      transforms,
      digestAlgorithm: digestAlgo,
      uri: refUri === null ? undefined : refUri,
      digestValue,
      inclusiveNamespacesPrefixList,
      isEmptyUri: refUri === "",
    });
  }

  loadSignature(signatureNode: string | Node) {
    if (typeof signatureNode === "string") {
      this.signatureNode = new DOMParser().parseFromString(signatureNode);
    } else {
      this.signatureNode = signatureNode;
    }

    this.signatureXml = this.signatureNode.toString();

    const canonicalizationAlgorithmNode = selectNodes(
      ".//*[local-name(.)='CanonicalizationMethod']/@Algorithm",
      this.signatureNode,
    )[0];
    if (!canonicalizationAlgorithmNode) {
      throw new Error(
        "could not find CanonicalizationMethod/@Algorithm element",
      );
    }
    if (isAttributeNode(canonicalizationAlgorithmNode)) {
      this.canonicalizationAlgorithm = canonicalizationAlgorithmNode.value;
    }

    const signatureAlgorithmNode = selectNodes(
      ".//*[local-name(.)='SignatureMethod']/@Algorithm",
      this.signatureNode,
    )[0];
    if (isAttributeNode(signatureAlgorithmNode)) {
      this.signatureAlgorithm = signatureAlgorithmNode.value;
    }

    const signedInfoNodes = findChildren(this.signatureNode, "SignedInfo");
    if (!isArrayHasLength(signedInfoNodes)) {
      throw new Error("no signed info node found");
    }
    if (signedInfoNodes.length > 1) {
      throw new Error(
        "could not load signature that contains multiple SignedInfo nodes",
      );
    }

    let canonicalizationAlgorithmForSignedInfo = this.canonicalizationAlgorithm;
    if (!canonicalizationAlgorithmForSignedInfo) {
      canonicalizationAlgorithmForSignedInfo =
        "http://www.w3.org/2001/10/xml-exc-c14n#";
    }

    const temporaryCanonSignedInfo = this.getCanonXml(
      [canonicalizationAlgorithmForSignedInfo],
      signedInfoNodes[0],
    );

    const temporaryCanonSignedInfoXml = new DOMParser().parseFromString(
      temporaryCanonSignedInfo,
      "text/xml",
    );
    const signedInfoDoc = temporaryCanonSignedInfoXml.documentElement;
    this.references = [];
    this.signedReferences = [];
    const references = findChildren(signedInfoDoc, "Reference");
    if (!isArrayHasLength(references)) {
      throw new Error("could not find any Reference elements");
    }
    for (const reference of references) {
      this.loadReference(reference);
    }

    const signatureValueNode = selectNodes(
      ".//*[local-name(.)='SignatureValue']/text()",
      this.signatureNode,
    )[0] as any;
    if (isTextNode(signatureValueNode)) {
      this.signatureValue = signatureValueNode.data.replace(/\r?\n/g, "");
    }

    const keyInfoNode = selectNodes(
      ".//*[local-name(.)='KeyInfo']",
      this.signatureNode,
    )[0];
    if (keyInfoNode) {
      this.keyInfo = keyInfoNode;
    }
  }

  private validateReference(ref: XmlReference, doc: Document): boolean {
    const uri = ref.uri && ref.uri[0] === "#" ? ref.uri.substring(1) : ref.uri;
    let elem: Node | null = null;

    if (uri === "") {
      elem = selectNodes("//*", doc)[0] || null;
    } else if (uri && uri.indexOf("'") !== -1) {
      throw new Error("Cannot validate a uri with quotes inside it");
    } else if (uri) {
      let numElementsForId = 0;
      for (const attr of this.idAttributes) {
        const tmpElemXpath = `//*[@*[local-name(.)='${attr}']='${uri}']`;
        const tmpElem = selectNodes(tmpElemXpath, doc);
        if (isArrayHasLength(tmpElem)) {
          numElementsForId += tmpElem.length;
          if (numElementsForId > 1) {
            throw new Error(
              "Cannot validate a document which contains multiple elements with the same value for ID attributes",
            );
          }
          elem = tmpElem[0];
          ref.xpath = tmpElemXpath;
        }
      }
    }

    if (!elem) {
      ref.validationError = new Error(
        `invalid signature: the signature references an element with uri ${ref.uri} but could not find such element in the xml`,
      );
      return false;
    }

    const canonXml = this.getCanonReferenceXml(doc, ref, elem);
    const hash = this.findHashAlgorithm(ref.digestAlgorithm);
    const digest = hash.getHash(canonXml);

    if (digest !== ref.digestValue) {
      ref.validationError = new Error(
        `invalid signature: for uri ${ref.uri} calculated digest is ${digest} but xml supplies digest ${ref.digestValue}`,
      );
      return false;
    }

    this.signedReferences.push(canonXml);
    ref.signedReference = canonXml;
    return true;
  }

  checkSignature(xml: string): boolean {
    this.signedXml = xml;
    const doc = new DOMParser().parseFromString(xml);

    this.references = [];
    const unverifiedSignedInfoCanon = this.getCanonSignedInfoXml(doc);
    if (!unverifiedSignedInfoCanon) {
      throw new Error("Canonical signed info cannot be empty");
    }

    const parsedUnverifiedSignedInfo = new DOMParser().parseFromString(
      unverifiedSignedInfoCanon,
      "text/xml",
    );
    const unverifiedSignedInfoDoc = parsedUnverifiedSignedInfo.documentElement;
    if (!unverifiedSignedInfoDoc) {
      throw new Error(
        "Could not parse unverifiedSignedInfoCanon into a document",
      );
    }

    const references = findChildren(unverifiedSignedInfoDoc, "Reference");
    if (!isArrayHasLength(references)) {
      throw new Error("could not find any Reference elements");
    }

    for (const reference of references) {
      this.loadReference(reference);
    }

    if (!this.references.every((ref) => this.validateReference(ref, doc))) {
      this.signedReferences = [];
      this.references.forEach((ref) => {
        ref.signedReference = undefined;
      });
      return false;
    }

    const signer = this.findSignatureAlgorithm(this.signatureAlgorithm);
    const key =
      this.publicCert ||
      this.getCertFromKeyInfo(this.keyInfo) ||
      this.privateKey;
    if (key == null) {
      throw new Error(
        "KeyInfo or publicCert or privateKey is required to validate signature",
      );
    }

    const result = signer.verifySignature(
      unverifiedSignedInfoCanon,
      key,
      this.signatureValue,
    );
    if (!result) {
      this.signedReferences = [];
      this.references.forEach((ref) => {
        ref.signedReference = undefined;
      });
    }
    return result;
  }

  getSignedXml(): string {
    return this.signedXml;
  }

  getSignatureXml(): string {
    return this.signatureXml;
  }

  getOriginalXmlWithIds(): string {
    return this.originalXmlWithIds;
  }

  setPrivateKey(privateKey: BinaryLike) {
    this.privateKey = toUtf8String(privateKey);
  }

  setPublicCert(publicCert: string) {
    this.publicCert = publicCert;
  }
}

export function createSignedXml() {
  return new SignedXml();
}

function getSigningScheme(
  sigAlg: string | undefined,
  nrsaAliasMapping: { [key: string]: string },
  defaultSignatureAlgorithm: string,
): string {
  if (sigAlg) {
    const algAlias = nrsaAliasMapping[sigAlg];
    if (!(algAlias === undefined)) {
      return algAlias;
    }
  }
  return nrsaAliasMapping[defaultSignatureAlgorithm];
}

export function constructMessageSignature(
  opts: ConstructMessageSignatureOptions,
): string {
  const {
    octetString,
    key,
    passphrase,
    isBase64,
    signingAlgorithm,
    nrsaAliasMapping,
    defaultSignatureAlgorithm,
    readPrivateKey,
    signMessage,
  } = opts;

  const signature = signMessage({
    octetString,
    privateKey: readPrivateKey(key, passphrase),
    signingScheme: getSigningScheme(
      signingAlgorithm,
      nrsaAliasMapping,
      defaultSignatureAlgorithm,
    ),
    isBase64Output: isBase64 !== false,
  });
  return isBase64 !== false
    ? String(signature)
    : (signature as unknown as string);
}

export function verifyMessageSignature(
  opts: VerifyMessageSignatureOptions,
): boolean {
  const {
    octetString,
    signature,
    signCert,
    verifyAlgorithm,
    nrsaAliasMapping,
    defaultSignatureAlgorithm,
    getPublicKeyPemFromCertificate,
    verifyMessage,
  } = opts;

  const signingScheme = getSigningScheme(
    verifyAlgorithm,
    nrsaAliasMapping,
    defaultSignatureAlgorithm,
  );
  return verifyMessage({
    octetString,
    signature,
    publicKey: getPublicKeyPemFromCertificate(signCert),
    signingScheme,
  });
}

export function constructSamlSignature(
  opts: ConstructSamlSignatureOptions,
): string {
  const {
    rawSamlMessage,
    referenceTagXPath,
    privateKey,
    privateKeyPass,
    signatureAlgorithm,
    transformationAlgorithms = [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    signingCert,
    signatureConfig,
    isBase64Output = true,
    isMessageSigned = false,
    getDigestMethod,
    getKeyInfo,
    readPrivateKey,
    base64Encode,
  } = opts;

  const sig = createSignedXml();
  const digestAlgorithm = getDigestMethod(signatureAlgorithm);

  if (!digestAlgorithm) {
    throw new Error("ERR_MISSING_DIGEST_ALGORITHM");
  }

  if (referenceTagXPath) {
    sig.addReference({
      xpath: referenceTagXPath,
      transforms: transformationAlgorithms,
      digestAlgorithm,
    });
  }
  if (isMessageSigned) {
    sig.addReference({
      xpath: "/*",
      transforms: transformationAlgorithms,
      digestAlgorithm,
    });
  }

  const signingCertString = toUtf8String(signingCert);

  sig.signatureAlgorithm = signatureAlgorithm;
  sig.setPublicCert(getKeyInfo(signingCertString, signatureConfig).getKey());
  sig.getKeyInfoContent = getKeyInfo(signingCertString, signatureConfig)
    .getKeyInfo as any;
  sig.setPrivateKey(
    readPrivateKey(privateKey, privateKeyPass, true) as BinaryLike,
  );
  sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";

  if (signatureConfig) {
    sig.computeSignature(rawSamlMessage, signatureConfig);
  } else {
    sig.computeSignature(rawSamlMessage);
  }

  return isBase64Output !== false
    ? base64Encode(sig.getSignedXml())
    : sig.getSignedXml();
}

export function signStringWithScheme(
  content: string,
  privateKeyPem: string,
  scheme: string,
): string {
  const signer = new Signature({ alg: mapSchemeToJsrsasignAlg(scheme) });
  signer.init(privateKeyPem);
  signer.updateString(content);
  return hextob64(signer.sign());
}

export function verifyStringWithScheme(
  content: string,
  signatureBase64: string,
  keyPem: string,
  scheme: string,
): boolean {
  const verifier = new Signature({ alg: mapSchemeToJsrsasignAlg(scheme) });
  verifier.init(KEYUTIL.getKey(keyPem));
  verifier.updateString(content);
  return verifier.verify(b64tohex(signatureBase64));
}
