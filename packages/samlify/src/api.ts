import { DOMParser as XmldomDOMParser } from "@xmldom/xmldom";

// global module configuration
interface Context extends ValidatorContext, DOMParserContext, FileIOContext {}

interface ValidatorContext {
  validate?: (xml: string) => Promise<any>;
}

export interface DOMParserOptions {
  [key: string]: any;
}

export interface DOMParserLike {
  parseFromString: (xml: string, mimeType?: string) => any;
}

interface DOMParserContext {
  dom?: DOMParserLike;
}

export interface FileIOContext {
  readFile?: (path: string) => string | Uint8Array;
  writeFile?: (path: string, content: string) => void;
}

function loadDomParserCtor(): any {
  const globalParser = (globalThis as any).DOMParser;
  if (typeof globalParser === "function") {
    return globalParser;
  }

  if (typeof XmldomDOMParser === "function") {
    return XmldomDOMParser;
  }

  throw new Error("ERR_DOM_PARSER_NOT_AVAILABLE");
}

const DOCTYPE_OR_ENTITY = /<!\s*(DOCTYPE|ENTITY)\b/i;

function rejectDoctypeOrEntity(xml: string): void {
  if (DOCTYPE_OR_ENTITY.test(xml)) {
    throw new Error("ERR_XML_DOCTYPE_OR_ENTITY_FORBIDDEN");
  }
}

function createDOMParser(options: DOMParserOptions = {}): DOMParserLike {
  const DOMParserCtor = loadDomParserCtor();
  const parser = new DOMParserCtor(options);
  return {
    parseFromString: (xml: string, mimeType = "text/xml") => {
      rejectDoctypeOrEntity(xml);
      return parser.parseFromString(xml, mimeType);
    },
  };
}

const context: Context = {
  validate: undefined,
  dom: undefined,
  readFile: undefined,
  writeFile: undefined,
};

export function getContext() {
  if (context.dom === undefined) {
    context.dom = createDOMParser();
  }
  return context;
}

/**
 * Parse XML through the configured DOMParser, with DOCTYPE/ENTITY rejection.
 * Use this for any XML coming from a network peer (IdP responses, signed
 * payloads, encrypted assertions) instead of constructing a `DOMParser`
 * directly — direct construction bypasses the doctype/entity guard.
 */
export function safeParseXml(xml: string, mimeType: string = "text/xml"): any {
  const { dom } = getContext();
  return dom!.parseFromString(xml, mimeType);
}

export function setSchemaValidator(params: ValidatorContext) {
  if (typeof params.validate !== "function") {
    throw new Error("validate must be a callback function having one argument as xml input");
  }

  context.validate = params.validate;
}

export function setDOMParserOptions(options: DOMParserOptions = {}) {
  context.dom = createDOMParser(options);
}

export function setFileIO(params: FileIOContext) {
  if (params.readFile !== undefined && typeof params.readFile !== "function") {
    throw new Error("readFile must be a callback function");
  }

  if (params.writeFile !== undefined && typeof params.writeFile !== "function") {
    throw new Error("writeFile must be a callback function");
  }

  context.readFile = params.readFile;
  context.writeFile = params.writeFile;
}
