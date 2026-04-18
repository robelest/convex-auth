import * as fontoxpathModule from "fontoxpath";

type FontoxpathApi = {
  evaluateXPathToNodes?: (expression: string, source: unknown) => unknown;
  evaluateXPathToString?: (expression: string, source: unknown) => string;
  default?: FontoxpathApi;
};

const fontoxpath = ((fontoxpathModule as FontoxpathApi).default ??
  fontoxpathModule) as FontoxpathApi;

if (
  typeof fontoxpath.evaluateXPathToNodes !== "function" ||
  typeof fontoxpath.evaluateXPathToString !== "function"
) {
  throw new Error(
    "[samlify] Failed to load fontoxpath XPath helpers from the installed module format.",
  );
}

export const evaluateXPathToNodes = fontoxpath.evaluateXPathToNodes;
export const evaluateXPathToString = fontoxpath.evaluateXPathToString;
