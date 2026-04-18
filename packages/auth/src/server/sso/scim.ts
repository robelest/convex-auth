import type { ScimListRequest } from "./shared";
import { SCIM_GROUP_SCHEMA_ID, SCIM_USER_SCHEMA_ID } from "./shared";

type ScimUserRecord = {
  name?: string;
  email?: string;
  phone?: string;
} & Record<string, unknown>;

type ScimGroupRecord = {
  name?: string;
} & Record<string, unknown>;

/** @internal */
export function parseScimPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const [api, auth, connections, connectionId, protocol, version, ...rest] = parts;

  if (
    api !== "api" ||
    auth !== "auth" ||
    connections !== "connections" ||
    !connectionId ||
    connectionId === "setup" ||
    protocol !== "scim" ||
    version !== "v2"
  ) {
    return {
      connectionId: "",
      resource: "",
      resourceId: undefined,
    };
  }

  return {
    connectionId,
    resource: rest[0] ?? "",
    resourceId: rest[1],
  };
}

/** @internal */
export function parseScimListRequest(url: URL): ScimListRequest {
  const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? "1"));
  const count = Math.min(100, Math.max(1, Number(url.searchParams.get("count") ?? "100")));
  const filterParam = url.searchParams.get("filter");
  const filter = filterParam
    ? (() => {
        const presentMatch = filterParam.match(/^([A-Za-z0-9_.]+)\s+pr$/);
        if (presentMatch) {
          return {
            attribute: presentMatch[1]!,
            operator: "pr" as const,
          };
        }
        const match = filterParam.match(
          /^([A-Za-z0-9_.]+(?:\[value eq "[^"]+"\])?)\s+(eq|co|sw|ew)\s+"([^"]+)"$/,
        );
        if (!match) {
          throw new Error("Unsupported SCIM filter.");
        }
        return {
          attribute: match[1]!,
          operator: match[2]! as "eq" | "co" | "sw" | "ew",
          value: match[3]!,
        };
      })()
    : undefined;
  return { startIndex, count, filter };
}

/** @internal */
export function scimJson(data: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers({
    "Content-Type": "application/scim+json",
  });
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      responseHeaders.set(key, value);
    });
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}

/** @internal */
export function scimError(status: number, scimType: string, detail: string) {
  return scimJson(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      scimType,
      detail,
    },
    status,
  );
}

/** @internal */
export function serializeScimUser(args: {
  id: string;
  user: ScimUserRecord;
  externalId?: string;
  active?: boolean;
  location?: string;
}) {
  return {
    schemas: [SCIM_USER_SCHEMA_ID],
    id: args.id,
    externalId: args.externalId,
    meta: {
      resourceType: "User",
      location: args.location,
    },
    userName: args.user.email ?? args.user.phone ?? args.user.name ?? args.id,
    active: args.active ?? true,
    name: args.user.name !== undefined ? { formatted: args.user.name } : undefined,
    emails:
      typeof args.user.email === "string" ? [{ value: args.user.email, primary: true }] : undefined,
    phoneNumbers:
      typeof args.user.phone === "string" ? [{ value: args.user.phone, primary: true }] : undefined,
    displayName: args.user.name,
  };
}

/** @internal */
export function serializeScimGroup(args: {
  id: string;
  group: ScimGroupRecord;
  externalId?: string;
  members?: Array<{ value: string; display?: string }>;
  location?: string;
}) {
  return {
    schemas: [SCIM_GROUP_SCHEMA_ID],
    id: args.id,
    externalId: args.externalId,
    meta: {
      resourceType: "Group",
      location: args.location,
    },
    displayName: args.group.name ?? args.id,
    members: args.members ?? [],
  };
}
