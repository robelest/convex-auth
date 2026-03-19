import { evaluateXPathToNodes, evaluateXPathToString } from "fontoxpath";

export type SelectedValue = Node | Attr | string | null;

export function selectXPath(expression: string, source: any): any {
  const normalizedExpression = expression.trim();
  if (normalizedExpression.startsWith("string(")) {
    return evaluateXPathToString(expression, source);
  }
  return evaluateXPathToNodes(expression, source) as SelectedValue[];
}
