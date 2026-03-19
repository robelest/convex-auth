export interface C14nNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  namespaceURI?: string | null;
  prefix?: string | null;
  tagName?: string;
  data?: string;
  nodeValue?: string | null;
  ownerDocument?: any;
  parentNode?: C14nNode | null;
  childNodes?: ArrayLike<C14nNode>;
  nextSibling?: C14nNode | null;
  previousSibling?: C14nNode | null;
  attributes?: C14nNamedNodeMap;
  documentElement?: C14nNode;
  removeChild?: (child: C14nNode) => C14nNode;
  getAttribute?: (name: string) => string | null;
  setAttributeNS?: (
    namespace: string,
    qualifiedName: string,
    value: string,
  ) => void;
}

export interface C14nAttr {
  name: string;
  value: string;
  localName: string;
  prefix?: string | null;
  namespaceURI?: string | null;
  nodeName: string;
  nodeValue?: string | null;
}

export interface C14nNamedNodeMap {
  length: number;
  [index: number]: C14nAttr;
  getNamedItem?: (name: string) => C14nAttr | null;
}

export interface NamespaceEntry {
  prefix: string;
  namespaceURI: string;
}

export interface C14nProcessOptions {
  inclusiveNamespacesPrefixList?: string[];
  defaultNs?: string;
  defaultNsForPrefix?: { [key: string]: string };
  ancestorNamespaces?: NamespaceEntry[];
  signatureNode?: C14nNode;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const PROCESSING_INSTRUCTION_NODE = 7;
const COMMENT_NODE = 8;

const xmlSpecialToEncodedAttribute: { [key: string]: string } = {
  "&": "&amp;",
  "<": "&lt;",
  '"': "&quot;",
  "\r": "&#xD;",
  "\n": "&#xA;",
  "\t": "&#x9;",
};

const xmlSpecialToEncodedText: { [key: string]: string } = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\r": "&#xD;",
};

function encodeSpecialCharactersInAttribute(attributeValue: string): string {
  return attributeValue.replace(
    /([&<"\r\n\t])/g,
    (_str, item) => xmlSpecialToEncodedAttribute[item],
  );
}

function encodeSpecialCharactersInText(text: string): string {
  return text.replace(
    /([&<>\r])/g,
    (_str, item) => xmlSpecialToEncodedText[item],
  );
}

function isElementNode(node: C14nNode): boolean {
  return node.nodeType === ELEMENT_NODE;
}

function isCommentNode(node: C14nNode): boolean {
  return node.nodeType === COMMENT_NODE;
}

function isTextNode(node: C14nNode): boolean {
  return node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE;
}

function isPrefixInScope(
  prefixesInScope: NamespaceEntry[],
  prefix: string,
  namespaceURI: string,
): boolean {
  for (const pf of prefixesInScope) {
    if (pf.prefix === prefix && pf.namespaceURI === namespaceURI) {
      return true;
    }
  }
  return false;
}

function attrCompare(a: C14nAttr, b: C14nAttr): number {
  if (!a.namespaceURI && b.namespaceURI) {
    return -1;
  }
  if (!b.namespaceURI && a.namespaceURI) {
    return 1;
  }
  const left = (a.namespaceURI || "") + a.localName;
  const right = (b.namespaceURI || "") + b.localName;
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function nsCompare(a: NamespaceEntry, b: NamespaceEntry): number {
  return a.prefix.localeCompare(b.prefix);
}

function findChildren(node: C14nNode, localName: string): C14nNode[] {
  const element = node.documentElement || node;
  const res: C14nNode[] = [];
  if (!element.childNodes) {
    return res;
  }
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i];
    if (isElementNode(child) && child.localName === localName) {
      res.push(child);
    }
  }
  return res;
}

function findDirectChildSignature(node: C14nNode): C14nNode | null {
  if (!node.childNodes) {
    return null;
  }
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (
      isElementNode(child) &&
      child.localName === "Signature" &&
      child.namespaceURI === "http://www.w3.org/2000/09/xmldsig#"
    ) {
      return child;
    }
  }
  return null;
}

function findAllSignatures(
  node: C14nNode,
  matches: C14nNode[] = [],
): C14nNode[] {
  if (
    isElementNode(node) &&
    node.localName === "Signature" &&
    node.namespaceURI === "http://www.w3.org/2000/09/xmldsig#"
  ) {
    matches.push(node);
  }

  if (node.childNodes) {
    for (let i = 0; i < node.childNodes.length; i++) {
      findAllSignatures(node.childNodes[i], matches);
    }
  }

  return matches;
}

function getSignatureValueText(signatureNode: C14nNode): string | null {
  if (!signatureNode.childNodes) {
    return null;
  }
  for (let i = 0; i < signatureNode.childNodes.length; i++) {
    const child = signatureNode.childNodes[i];
    if (
      isElementNode(child) &&
      child.localName === "SignatureValue" &&
      child.childNodes
    ) {
      for (let j = 0; j < child.childNodes.length; j++) {
        const textNode = child.childNodes[j];
        if (isTextNode(textNode) && typeof textNode.data === "string") {
          return textNode.data;
        }
      }
    }
  }
  return null;
}

export class ExclusiveCanonicalization {
  includeComments = false;

  renderComment(node: C14nNode): string {
    if (!this.includeComments) {
      return "";
    }

    const isOutsideDocument = node.ownerDocument === node.parentNode;
    let isBeforeDocument = false;
    let isAfterDocument = false;

    if (isOutsideDocument) {
      let nextNode: C14nNode | null | undefined = node;
      let previousNode: C14nNode | null | undefined = node;
      while (nextNode != null) {
        if (nextNode === node.ownerDocument.documentElement) {
          isBeforeDocument = true;
          break;
        }
        nextNode = nextNode.nextSibling;
      }
      while (previousNode != null) {
        if (previousNode === node.ownerDocument.documentElement) {
          isAfterDocument = true;
          break;
        }
        previousNode = previousNode.previousSibling;
      }
    }

    const afterDocument = isAfterDocument ? "\n" : "";
    const beforeDocument = isBeforeDocument ? "\n" : "";
    const encodedText = encodeSpecialCharactersInText(node.data || "");
    return `${afterDocument}<!--${encodedText}-->${beforeDocument}`;
  }

  renderAttrs(node: C14nNode): string {
    if (isCommentNode(node)) {
      return this.renderComment(node);
    }

    const attrListToRender: C14nAttr[] = [];
    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        if (attr.name.indexOf("xmlns") === 0) {
          continue;
        }
        attrListToRender.push(attr);
      }
    }

    attrListToRender.sort(attrCompare);
    const res: string[] = [];
    for (const attr of attrListToRender) {
      res.push(
        " ",
        attr.name,
        '="',
        encodeSpecialCharactersInAttribute(attr.value),
        '"',
      );
    }
    return res.join("");
  }

  renderNs(
    node: C14nNode,
    prefixesInScope: NamespaceEntry[],
    defaultNs: string,
    defaultNsForPrefix: { [key: string]: string },
    inclusiveNamespacesPrefixList: string[],
  ): { rendered: string; newDefaultNs: string } {
    const res: string[] = [];
    let newDefaultNs = defaultNs;
    const nsListToRender: NamespaceEntry[] = [];
    const currNs = node.namespaceURI || "";

    if (node.prefix) {
      const nodeNs = node.namespaceURI || defaultNsForPrefix[node.prefix] || "";
      if (!isPrefixInScope(prefixesInScope, node.prefix, nodeNs)) {
        nsListToRender.push({ prefix: node.prefix, namespaceURI: nodeNs });
        prefixesInScope.push({ prefix: node.prefix, namespaceURI: nodeNs });
      }
    } else if (defaultNs !== currNs) {
      newDefaultNs = node.namespaceURI || "";
      res.push(' xmlns="', newDefaultNs, '"');
    }

    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];

        if (
          attr.prefix &&
          !isPrefixInScope(prefixesInScope, attr.localName, attr.value) &&
          inclusiveNamespacesPrefixList.indexOf(attr.localName) >= 0
        ) {
          nsListToRender.push({
            prefix: attr.localName,
            namespaceURI: attr.value,
          });
          prefixesInScope.push({
            prefix: attr.localName,
            namespaceURI: attr.value,
          });
        }

        if (
          attr.prefix &&
          !isPrefixInScope(
            prefixesInScope,
            attr.prefix,
            attr.namespaceURI || "",
          ) &&
          attr.prefix !== "xmlns" &&
          attr.prefix !== "xml"
        ) {
          nsListToRender.push({
            prefix: attr.prefix,
            namespaceURI: attr.namespaceURI || "",
          });
          prefixesInScope.push({
            prefix: attr.prefix,
            namespaceURI: attr.namespaceURI || "",
          });
        }
      }
    }

    nsListToRender.sort(nsCompare);
    for (const p of nsListToRender) {
      res.push(" xmlns:", p.prefix, '="', p.namespaceURI, '"');
    }

    return { rendered: res.join(""), newDefaultNs };
  }

  processInner(
    node: C14nNode,
    prefixesInScope: NamespaceEntry[],
    defaultNs: string,
    defaultNsForPrefix: { [key: string]: string },
    inclusiveNamespacesPrefixList: string[],
  ): string {
    if (isCommentNode(node)) {
      return this.renderComment(node);
    }

    if (isTextNode(node)) {
      return encodeSpecialCharactersInText(node.data || "");
    }

    if (node.nodeType === PROCESSING_INSTRUCTION_NODE) {
      return "";
    }

    if (isElementNode(node)) {
      const ns = this.renderNs(
        node,
        prefixesInScope,
        defaultNs,
        defaultNsForPrefix,
        inclusiveNamespacesPrefixList,
      );
      const nodeTag = node.tagName || node.nodeName;
      const res = ["<", nodeTag, ns.rendered, this.renderAttrs(node), ">"];
      if (node.childNodes) {
        for (let i = 0; i < node.childNodes.length; i++) {
          const pfxCopy = prefixesInScope.slice(0);
          res.push(
            this.processInner(
              node.childNodes[i],
              pfxCopy,
              ns.newDefaultNs,
              defaultNsForPrefix,
              inclusiveNamespacesPrefixList,
            ),
          );
        }
      }
      res.push("</", nodeTag, ">");
      return res.join("");
    }

    throw new Error(
      `Unable to exclusive canonicalize node type: ${node.nodeType}`,
    );
  }

  process(elem: C14nNode, options: C14nProcessOptions = {}): string {
    let inclusiveNamespacesPrefixList =
      options.inclusiveNamespacesPrefixList || [];
    const defaultNs = options.defaultNs || "";
    const defaultNsForPrefix = options.defaultNsForPrefix || {};
    const ancestorNamespaces = options.ancestorNamespaces || [];

    if (inclusiveNamespacesPrefixList.length === 0) {
      const canonicalizationMethod = findChildren(
        elem,
        "CanonicalizationMethod",
      );
      if (canonicalizationMethod.length !== 0) {
        const inclusiveNamespaces = findChildren(
          canonicalizationMethod[0],
          "InclusiveNamespaces",
        );
        if (
          inclusiveNamespaces.length !== 0 &&
          inclusiveNamespaces[0].getAttribute
        ) {
          const prefixList =
            inclusiveNamespaces[0].getAttribute("PrefixList") || "";
          inclusiveNamespacesPrefixList = prefixList.split(" ").filter(Boolean);
        }
      }
    }

    if (inclusiveNamespacesPrefixList.length > 0) {
      inclusiveNamespacesPrefixList.forEach((prefix) => {
        ancestorNamespaces.forEach((ancestorNamespace) => {
          if (prefix === ancestorNamespace.prefix && elem.setAttributeNS) {
            elem.setAttributeNS(
              "http://www.w3.org/2000/xmlns/",
              `xmlns:${prefix}`,
              ancestorNamespace.namespaceURI,
            );
          }
        });
      });
    }

    return this.processInner(
      elem,
      [],
      defaultNs,
      defaultNsForPrefix,
      inclusiveNamespacesPrefixList,
    );
  }

  getAlgorithmName(): string {
    return "http://www.w3.org/2001/10/xml-exc-c14n#";
  }
}

export class ExclusiveCanonicalizationWithComments extends ExclusiveCanonicalization {
  includeComments = true;

  getAlgorithmName(): string {
    return "http://www.w3.org/2001/10/xml-exc-c14n#WithComments";
  }
}

export class EnvelopedSignature {
  process(node: C14nNode, options: C14nProcessOptions = {}): C14nNode {
    if (options.signatureNode == null) {
      const signature = findDirectChildSignature(node);
      if (
        signature &&
        signature.parentNode &&
        signature.parentNode.removeChild
      ) {
        signature.parentNode.removeChild(signature);
      }
      return node;
    }

    const expectedSignatureValue = getSignatureValueText(options.signatureNode);
    if (expectedSignatureValue) {
      const signatures = findAllSignatures(node);
      for (const nodeSignature of signatures) {
        const signatureValue = getSignatureValueText(nodeSignature);
        if (signatureValue && signatureValue === expectedSignatureValue) {
          if (
            nodeSignature.parentNode &&
            nodeSignature.parentNode.removeChild
          ) {
            nodeSignature.parentNode.removeChild(nodeSignature);
          }
        }
      }
    }

    return node;
  }

  getAlgorithmName(): string {
    return "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
  }
}

export type TransformAlgorithm =
  | ExclusiveCanonicalization
  | ExclusiveCanonicalizationWithComments
  | EnvelopedSignature;

export function getTransformByAlgorithm(algorithm: string): TransformAlgorithm {
  switch (algorithm) {
    case "http://www.w3.org/2001/10/xml-exc-c14n#":
      return new ExclusiveCanonicalization();
    case "http://www.w3.org/2001/10/xml-exc-c14n#WithComments":
      return new ExclusiveCanonicalizationWithComments();
    case "http://www.w3.org/2000/09/xmldsig#enveloped-signature":
      return new EnvelopedSignature();
    default:
      throw new Error(
        `canonicalization algorithm '${algorithm}' is not supported`,
      );
  }
}

export function applyTransforms(
  transforms: string[],
  node: C14nNode,
  options: C14nProcessOptions = {},
): string {
  let transformed: C14nNode | string = node;

  transforms.forEach((transformName) => {
    if (typeof transformed !== "string") {
      const transform = getTransformByAlgorithm(transformName);
      transformed = transform.process(transformed, options) as any;
    }
  });

  return transformed.toString();
}
