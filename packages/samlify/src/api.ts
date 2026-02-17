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
  dom: DOMParserLike;
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

  const moduleName = "@xmldom/xmldom";

  try {
    const runtimeModule: any = (globalThis as any).module;
    if (runtimeModule && typeof runtimeModule.require === "function") {
      const m = runtimeModule.require(moduleName);
      if (m && typeof m.DOMParser === "function") {
        return m.DOMParser;
      }
    }
  } catch (_e) {
    // fallback below
  }

  try {
    if (typeof require === "function") {
      const m = require(moduleName);
      if (m && typeof m.DOMParser === "function") {
        return m.DOMParser;
      }
    }
  } catch (_e) {
    // fallback below
  }

  try {
    const dynamicRequire = (0, eval)("require");
    if (typeof dynamicRequire === "function") {
      const m = dynamicRequire(moduleName);
      if (m && typeof m.DOMParser === "function") {
        return m.DOMParser;
      }
    }
  } catch (_e) {
    // no-op
  }

  throw new Error("ERR_DOM_PARSER_NOT_AVAILABLE");
}

function createDOMParser(options: DOMParserOptions = {}): DOMParserLike {
  const DOMParserCtor = loadDomParserCtor();
  return new DOMParserCtor(options);
}

const context: Context = {
  validate: undefined,
  dom: createDOMParser(),
  readFile: undefined,
  writeFile: undefined,
};

export function getContext() {
  return context;
}

export function setSchemaValidator(params: ValidatorContext) {
  if (typeof params.validate !== "function") {
    throw new Error(
      "validate must be a callback function having one argument as xml input",
    );
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

  if (
    params.writeFile !== undefined &&
    typeof params.writeFile !== "function"
  ) {
    throw new Error("writeFile must be a callback function");
  }

  context.readFile = params.readFile;
  context.writeFile = params.writeFile;
}
