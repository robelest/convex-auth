function escapeXmlText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(input: string): string {
  return escapeXmlText(input).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function renderAttributes(attrs: { [key: string]: any }): string {
  return Object.keys(attrs)
    .map((key) => {
      const value = attrs[key];
      return ` ${key}="${escapeXmlAttribute(String(value))}"`;
    })
    .join("");
}

function renderValue(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(renderValue).join("");
  }

  if (typeof value === "object") {
    return Object.keys(value)
      .map((tagName) => renderElement(tagName, value[tagName]))
      .join("");
  }

  return escapeXmlText(String(value));
}

function renderElement(tagName: string, value: any): string {
  let attrs = "";
  let body = "";

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        item._attr
      ) {
        attrs += renderAttributes(item._attr);
        return;
      }
      body += renderValue(item);
    });
    return `<${tagName}${attrs}>${body}</${tagName}>`;
  }

  if (value && typeof value === "object") {
    if (value._attr) {
      attrs += renderAttributes(value._attr);
      const copied = { ...value };
      delete copied._attr;
      body += renderValue(copied);
    } else {
      body += renderValue(value);
    }
    return `<${tagName}${attrs}>${body}</${tagName}>`;
  }

  body = renderValue(value);
  return `<${tagName}${attrs}>${body}</${tagName}>`;
}

export default function buildXml(nodes: any[]): string {
  return nodes.map(renderValue).join("");
}
