import type { GenericActionCtx, GenericDataModel, HttpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { serialize as serializeCookie } from "cookie";

import { configDefaults } from "../config";
import {
  deleteScimIdentity,
  getScimIdentity,
  getScimIdentityByConnectionAndUser,
  getScimIdentityByMappedGroup,
  insertAccount,
  insertUser,
  listScimIdentitiesByConnection,
  patchUser,
  upsertScimIdentity,
  type ScimIdentityRecord,
} from "../contract";
import { redirectToParamCookie, useRedirectToParam } from "../cookies";
import { addSSORoutes, convertErrorsToResponse, getCookies } from "../http";
import type { SSORuntimeRoute } from "../http";
import { createOAuthAuthorizationURL, handleOAuthCallback } from "../oauth/runtime";
import type { AuthAccountExtend, AuthProfile } from "../payloads";
import { redirectAbsoluteUrl, setURLSearchParam } from "../redirects";
import { createGroupConnectionOidcRuntime } from "./oidc";
import { resolveProvisionedRoleIds } from "./policy";
import { finalizeNormalizedProfile, normalizeStringArray } from "./profile";
import {
  createGroupConnectionSamlMetadataXml,
  createGroupConnectionSamlSignInRequest,
  createSamlPostBindingResponse,
  encodeGroupSamlRelayState,
  enforceGroupConnectionSamlSecurity,
  parseGroupConnectionSamlLoginResponse,
  parseGroupConnectionSamlLogoutMessage,
  profileFromSamlExtract,
  validateGroupConnectionSamlLoginRelayState,
} from "./saml";
import {
  parseScimListRequest,
  scimError,
  scimJson,
  serializeScimGroup,
  serializeScimUser,
} from "./scim";
import {
  decodeGroupOidcState,
  encodeGroupOidcState,
  groupOidcProviderId,
  groupSamlProviderId,
  SCIM_GROUP_SCHEMA_ID,
  SCIM_USER_SCHEMA_ID,
} from "./shared";

type ComponentConfig = ReturnType<typeof configDefaults>;

type AuthRuntime = {
  user: {
    get(ctx: GenericActionCtx<GenericDataModel>, userId: string): Promise<UserRecord | null>;
  };
  group: {
    get(ctx: GenericActionCtx<GenericDataModel>, groupId: string): Promise<GroupRecord | null>;
    list(
      ctx: GenericActionCtx<GenericDataModel>,
      opts: { where?: Record<string, unknown>; limit?: number },
    ): Promise<{ items: Array<Record<string, unknown>> }>;
    create(
      ctx: GenericActionCtx<GenericDataModel>,
      args: { name: string; parentGroupId: string; type: string },
    ): Promise<{ groupId: string }>;
    update(
      ctx: GenericActionCtx<GenericDataModel>,
      groupId: string,
      data: Record<string, unknown>,
    ): Promise<unknown>;
    delete(ctx: GenericActionCtx<GenericDataModel>, groupId: string): Promise<unknown>;
  };
  member: {
    list(
      ctx: GenericActionCtx<GenericDataModel>,
      opts: { where?: Record<string, unknown>; limit?: number },
    ): Promise<{
      items: Array<{ _id: string; userId: string; status?: string }>;
    }>;
    create(
      ctx: GenericActionCtx<GenericDataModel>,
      args: {
        groupId: string;
        userId: string;
        roleIds: string[];
        status: string;
      },
    ): Promise<unknown>;
    update(
      ctx: GenericActionCtx<GenericDataModel>,
      memberId: string,
      data: Record<string, unknown>,
    ): Promise<unknown>;
    delete(ctx: GenericActionCtx<GenericDataModel>, memberId: string): Promise<unknown>;
    inspect(
      ctx: GenericActionCtx<GenericDataModel>,
      args: { groupId: string; userId: string },
    ): Promise<{ membership: { _id: string } | null }>;
  };
};

type ActiveSamlConnection = {
  loaded: {
    source: { kind: "connection"; id: string };
    config: unknown;
    [key: string]: unknown;
  };
  connection: { _id: string; groupId: string };
  saml: Record<string, unknown>;
};

type OidcConnection = {
  connection: { _id: string; groupId: string };
  oidc: Record<string, unknown>;
};

type ScimContext = {
  parsedPath: {
    connectionId: string;
    resource: string;
    resourceId?: string;
  };
  connection: { _id: string; groupId: string; protocol: "oidc" | "saml" };
  scimConfig: {
    _id: string;
    connectionId: string;
    status: string;
    extend?: unknown;
  };
};

type GroupPolicy = {
  provisioning: {
    user: {
      authority: "app" | "sso" | "scim";
      updateProfileOnLogin: "never" | "missing" | "always";
      updateProfileFromScim: "never" | "missing" | "always";
    };
    jit: { defaultRoleIds: string[] };
    deprovision: { mode: "hard" | "soft" };
    groups: {
      mode: "ignore" | "sync";
      mapping?: Record<string, string[]>;
    };
    roles: {
      mode: "ignore" | "map";
      mapping?: Record<string, string[]>;
    };
  };
};

type CookieToSerialize = {
  name: string;
  value: string;
  options: Parameters<typeof serializeCookie>[2];
};

async function getOidcCallbackParams(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.searchParams);
  if (request.headers.get("Content-Type")?.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    formData.forEach((value, key) => {
      if (typeof value === "string") {
        params.append(key, value);
      }
    });
  }
  return params;
}

type MemberRecord = { _id: string; userId: string; status?: string };
type UserRecord = { _id: string; email?: string } & Record<string, unknown>;
type GroupRecord = { _id: string; name?: string } & Record<string, unknown>;

type UserListItem = {
  user: UserRecord;
  member: MemberRecord;
  identity?: ScimIdentityRecord;
};

type GroupListItem = {
  group: GroupRecord;
  identity?: ScimIdentityRecord;
  memberIds?: string[];
};

export type GroupHttpRuntimeDeps = {
  http: HttpRouter;
  hasSSO: boolean;
  auth: AuthRuntime;
  config: ComponentConfig;
  routeBase: string;
  requireEnv: (name: string) => string;
  loadActiveConnectionSamlOrThrow: (
    ctx: GenericActionCtx<GenericDataModel>,
    connectionId: string,
  ) => Promise<ActiveSamlConnection>;
  loadConnectionOidcOrThrow: (
    ctx: GenericActionCtx<GenericDataModel>,
    connectionId: string,
  ) => Promise<OidcConnection>;
  getGroupConnectionScimContext: (
    ctx: GenericActionCtx<GenericDataModel>,
    request: Request,
  ) => Promise<ScimContext>;
  loadGroupPolicyOrThrow: (
    ctx: GenericActionCtx<GenericDataModel>,
    groupId: string,
  ) => Promise<GroupPolicy>;
  normalizeGroupConnectionPolicy: (policy: unknown) => GroupPolicy;
  recordGroupAuditEvent: (
    ctx: GenericActionCtx<GenericDataModel>,
    args: {
      connectionId?: string;
      groupId: string;
      eventType: string;
      actorType: "user" | "system" | "scim" | "api_key" | "webhook";
      actorId?: string;
      subjectType: string;
      subjectId?: string;
      ok: boolean;
      requestId?: string;
      ip?: string;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<string>;
  emitGroupWebhookDeliveries: (
    ctx: GenericActionCtx<GenericDataModel>,
    args: {
      connectionId: string;
      eventType: string;
      payload: Record<string, unknown>;
      auditEventId?: string;
    },
  ) => Promise<void>;
  generateRandomString: (length: number, alphabet: string) => string;
  inviteTokenAlphabet: string;
  callUserOAuth: (
    ctx: GenericActionCtx<GenericDataModel>,
    args: {
      provider: string;
      providerAccountId: string;
      signature: string;
      profile: AuthProfile;
      accountExtend?: AuthAccountExtend;
    },
  ) => Promise<string>;
  callVerifierSignature: (
    ctx: GenericActionCtx<GenericDataModel>,
    args: { verifier: string; signature: string },
  ) => Promise<void>;
  sharedOidcRedirectURI?: string;
};

export function addGroupHttpRuntime(deps: GroupHttpRuntimeDeps) {
  if (!deps.hasSSO) {
    return;
  }

  const {
    http,
    auth,
    config,
    requireEnv,
    loadActiveConnectionSamlOrThrow,
    loadConnectionOidcOrThrow,
    getGroupConnectionScimContext,
    loadGroupPolicyOrThrow,
    recordGroupAuditEvent,
    emitGroupWebhookDeliveries,
    generateRandomString,
    inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
    callUserOAuth,
    callVerifierSignature,
    sharedOidcRedirectURI,
  } = deps;
  const GROUP_CONNECTION_ROUTE_BASE = deps.routeBase;

  type ScimState = {
    ctx: GenericActionCtx<GenericDataModel>;
    request: Request;
    url: URL;
    parsedPath: ScimContext["parsedPath"];
    connection: ScimContext["connection"];
    scimConfig: ScimContext["scimConfig"];
    policy: GroupPolicy;
    recordScimEvent: (
      eventType: string,
      ok: boolean,
      subjectType: string,
      subjectId?: string,
      metadata?: Record<string, unknown>,
    ) => Promise<void>;
  };

  type ScimHandler = (state: ScimState) => Promise<Response>;

  const convexError = (code: string, message: string) => new ConvexError({ code, message });

  const SCIM_SCHEMAS = [
    {
      id: SCIM_USER_SCHEMA_ID,
      name: "User",
      description: "User Account",
      attributes: [
        { name: "userName", type: "string", required: true },
        { name: "displayName", type: "string" },
        { name: "active", type: "boolean" },
        { name: "emails", type: "complex", multiValued: true },
      ],
    },
    {
      id: SCIM_GROUP_SCHEMA_ID,
      name: "Group",
      description: "Group",
      attributes: [
        { name: "displayName", type: "string", required: true },
        { name: "members", type: "complex", multiValued: true },
      ],
    },
  ] as const;

  const SCIM_RESOURCE_TYPES = [
    {
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: SCIM_USER_SCHEMA_ID,
    },
    {
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      schema: SCIM_GROUP_SCHEMA_ID,
    },
  ] as const;

  const handleStaticScimCollection = <T extends { id?: string; name?: string }>(
    items: readonly T[],
    resourceId: string | undefined,
    opts: { by: "id" | "name"; notFound: string },
  ) => {
    if (resourceId !== undefined) {
      const item = items.find((entry) => entry[opts.by] === decodeURIComponent(resourceId));
      return item ? scimJson(item) : scimError(404, "notFound", opts.notFound);
    }
    return scimJson({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      Resources: items,
      totalResults: items.length,
      startIndex: 1,
      itemsPerPage: items.length,
    });
  };

  const pickPrimaryEmail = (body: ScimBody) =>
    Array.isArray(body.emails)
      ? (body.emails.find((entry) => entry.primary === true)?.value ?? body.emails[0]?.value)
      : undefined;

  const pickDisplayName = (body: ScimBody) => {
    const name = typeof body.name === "object" && body.name !== null ? body.name : undefined;
    const derivedName = [name?.givenName, name?.familyName].filter(Boolean).join(" ");
    if (body.displayName !== undefined) {
      return body.displayName;
    }
    if (name?.formatted !== undefined) {
      return name.formatted;
    }
    return derivedName !== "" ? derivedName : undefined;
  };

  const pickPhone = (body: ScimBody) =>
    Array.isArray(body.phoneNumbers) ? body.phoneNumbers[0]?.value : undefined;

  const getScimProfileConfig = (scimConfig: { extend?: unknown } | null | undefined) => {
    const extend =
      typeof scimConfig?.extend === "object" && scimConfig.extend !== null
        ? (scimConfig.extend as Record<string, unknown>)
        : {};
    const profile =
      typeof extend.profile === "object" && extend.profile !== null
        ? (extend.profile as Record<string, unknown>)
        : {};
    return {
      mapping:
        typeof profile.mapping === "object" && profile.mapping !== null
          ? (profile.mapping as Record<string, string>)
          : {},
      extraFields:
        typeof profile.extraFields === "object" && profile.extraFields !== null
          ? (profile.extraFields as Record<string, string>)
          : {},
    };
  };

  const resolveScimField = (body: ScimBody, key: string | undefined) => {
    switch (key) {
      case "userName":
        return body.userName;
      case "externalId":
        return body.externalId;
      case "displayName":
        return body.displayName;
      case "name.formatted":
        return body.name?.formatted;
      case "name.givenName":
        return body.name?.givenName;
      case "name.familyName":
        return body.name?.familyName;
      case "emails.primary":
        return pickPrimaryEmail(body);
      case "emails.value":
        return Array.isArray(body.emails)
          ? body.emails.map((entry) => entry.value).filter(Boolean)
          : undefined;
      case "phoneNumbers.primary":
      case "phoneNumbers.value":
        return pickPhone(body);
      case "active":
        return body.active;
      case "groups":
        return (body as Record<string, unknown>).groups;
      case "roles":
        return (body as Record<string, unknown>).roles;
      default:
        return key ? (body as Record<string, unknown>)[key] : undefined;
    }
  };

  const extractScimProfile = (
    scimConfig: { extend?: unknown } | null | undefined,
    body: ScimBody,
  ) => {
    const { mapping, extraFields } = getScimProfileConfig(scimConfig);
    const extend = Object.fromEntries(
      Object.entries(extraFields)
        .map(([fieldName, source]) => [fieldName, resolveScimField(body, source)])
        .filter(([, value]) => value !== undefined),
    );

    return finalizeNormalizedProfile({
      externalId:
        (resolveScimField(body, mapping.externalId) as string | undefined) ??
        (typeof body.externalId === "string" ? body.externalId : undefined),
      name: (resolveScimField(body, mapping.name) as string | undefined) ?? pickDisplayName(body),
      firstName: resolveScimField(body, mapping.firstName) as string | undefined,
      lastName: resolveScimField(body, mapping.lastName) as string | undefined,
      email:
        (resolveScimField(body, mapping.email) as string | undefined) ??
        pickPrimaryEmail(body) ??
        body.userName,
      phone: (resolveScimField(body, mapping.phone) as string | undefined) ?? pickPhone(body),
      active: (resolveScimField(body, mapping.active) as boolean | undefined) ?? body.active,
      groups: pickStringArray(resolveScimField(body, mapping.groups)),
      roles: pickStringArray(resolveScimField(body, mapping.roles)),
      extend: Object.keys(extend).length > 0 ? extend : undefined,
    });
  };

  const pickStringArray = (value: unknown) => {
    return normalizeStringArray(
      Array.isArray(value)
        ? value.map((entry) => {
            if (typeof entry === "string") {
              return entry;
            }
            if (
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as { value?: unknown }).value === "string"
            ) {
              return (entry as { value: string }).value;
            }
            return undefined;
          })
        : value,
    );
  };

  const normalizeScimValues = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => normalizeScimValues(entry));
    }
    if (typeof value === "string") {
      return [value];
    }
    if (typeof value === "boolean") {
      return [String(value)];
    }
    return [];
  };

  const applyUserProvisioningPatch = (args: {
    currentUser: Record<string, unknown>;
    nextUser: Record<string, unknown>;
    policy: {
      authority?: "app" | "sso" | "scim";
      updateProfileOnLogin?: "never" | "missing" | "always";
      updateProfileFromScim?: "never" | "missing" | "always";
    };
    source: "scim";
  }) => {
    const mode = args.policy.updateProfileFromScim ?? "always";
    if (mode === "never") {
      return {};
    }
    if (mode === "always") {
      return args.nextUser;
    }
    return Object.fromEntries(
      Object.entries(args.nextUser).filter(([key, value]) => {
        if (value === undefined) {
          return false;
        }
        const current = args.currentUser[key];
        return current === undefined || current === null || current === "";
      }),
    );
  };

  const filterScimCollection = <T>(
    items: T[],
    filter: ReturnType<typeof parseScimListRequest>["filter"],
    filters: Record<string, (item: T) => unknown>,
  ) => {
    if (!filter) {
      return items;
    }
    const accessor = filters[filter.attribute];
    if (!accessor) {
      throw new Error("Unsupported SCIM filter.");
    }
    return items.filter((item) => {
      const values = normalizeScimValues(accessor(item));
      switch (filter.operator) {
        case "pr":
          return values.length > 0;
        case "eq":
          return values.includes(filter.value ?? "");
        case "co":
          return values.some((value) => value.includes(filter.value ?? ""));
        case "sw":
          return values.some((value) => value.startsWith(filter.value ?? ""));
        case "ew":
          return values.some((value) => value.endsWith(filter.value ?? ""));
      }
    });
  };

  const paginateScimCollection = <T>(
    items: T[],
    listRequest: ReturnType<typeof parseScimListRequest>,
  ) => {
    const start = listRequest.startIndex - 1;
    return items.slice(start, start + listRequest.count);
  };

  const requireScimResourceId = (resourceId: string | undefined, label: string) => {
    if (!resourceId) {
      return scimError(400, "invalidPath", `${label} resource ID is required.`);
    }
    return null;
  };

  const readScimJson = async (request: Request) =>
    (await request.json()) as Record<string, unknown>;

  type ScimBody = Record<string, unknown> & {
    displayName?: string;
    userName?: string;
    active?: boolean;
    externalId?: string;
    emails?: Array<{ value?: string; primary?: boolean }>;
    phoneNumbers?: Array<{ value?: string }>;
    name?: { formatted?: string; givenName?: string; familyName?: string };
    Operations?: Array<{ op?: string; path?: string; value?: unknown }>;
    members?: Array<{ value?: string }>;
  };

  const handleSamlAcs = async (
    ctx: GenericActionCtx<GenericDataModel>,
    request: Request,
    runtimeRoute: SSORuntimeRoute,
  ) => {
    if (
      runtimeRoute.protocol !== "saml" ||
      runtimeRoute.rest.length !== 1 ||
      runtimeRoute.rest[0] !== "acs"
    ) {
      throw convexError("INVALID_PARAMETERS", "Invalid connection runtime path.");
    }

    const connectionId = runtimeRoute.connectionId;
    const loadedConnection = await loadActiveConnectionSamlOrThrow(ctx, connectionId);
    const { loaded, connection, saml } = loadedConnection;

    let parsedResponse;
    try {
      parsedResponse = await parseGroupConnectionSamlLoginResponse({
        request,
        rootUrl: requireEnv("CONVEX_SITE_URL"),
        source: { kind: "connection", id: connection._id },
        config: loaded.config,
      });
    } catch (error) {
      throw convexError(
        "OAUTH_PROVIDER_ERROR",
        `SAML response parse failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      enforceGroupConnectionSamlSecurity({
        extract: parsedResponse.parsed.extract,
        config: loaded.config,
      });
    } catch (error) {
      throw convexError(
        "OAUTH_PROVIDER_ERROR",
        error instanceof Error ? error.message : "SAML assertion failed security validation.",
      );
    }

    try {
      validateGroupConnectionSamlLoginRelayState({
        relayState: parsedResponse.relayState,
        source: { kind: "connection", id: connection._id },
        inResponseTo: parsedResponse.parsed.extract?.response?.inResponseTo,
      });
    } catch {
      throw convexError(
        "OAUTH_INVALID_STATE",
        "SAML RelayState did not match the pending login request.",
      );
    }

    const { samlAttributes, samlSessionIndex, ...userProfile } = profileFromSamlExtract(
      parsedResponse.parsed.extract,
      ((saml.profile as Record<string, unknown> | undefined)?.mapping ?? {}) as
        | Record<string, string>
        | undefined,
    );
    const profile = userProfile as Record<string, unknown> & {
      id: string;
    };
    const extraFields =
      typeof saml.profile === "object" && saml.profile !== null
        ? ((saml.profile as Record<string, unknown>).extraFields as
            | Record<string, string>
            | undefined)
        : undefined;
    if (extraFields) {
      const extend: Record<string, unknown> = {};
      for (const [fieldName, attributeName] of Object.entries(extraFields)) {
        const value = samlAttributes[attributeName];
        if (value !== undefined) {
          extend[fieldName] = value;
        }
      }
      if (Object.keys(extend).length > 0) {
        profile.extend = extend;
      }
    }

    const maybeRedirectTo = useRedirectToParam(
      groupSamlProviderId(connection._id),
      getCookies(request),
    );

    const verificationCode = await callUserOAuth(ctx, {
      provider: groupSamlProviderId(connection._id),
      providerAccountId: profile.id,
      profile: profile as AuthProfile,
      signature: parsedResponse.relayState.signature,
      accountExtend: {
        identity: {
          protocol: "saml",
          connectionId: connection._id,
          subject: profile.id,
          entityId: typeof saml.entityId === "string" ? saml.entityId : undefined,
        },
        saml: {
          attributes: samlAttributes as Record<string, string | string[]>,
          sessionIndex: samlSessionIndex,
        },
      },
    });

    const destinationUrl = await redirectAbsoluteUrl(config, {
      redirectTo:
        maybeRedirectTo?.redirectTo ??
        (typeof parsedResponse.relayState.redirectTo === "string"
          ? parsedResponse.relayState.redirectTo
          : undefined),
    });

    const vurl = setURLSearchParam(destinationUrl, "code", verificationCode);
    const vheaders = new Headers({ Location: vurl });
    vheaders.set("Cache-Control", "must-revalidate");
    for (const { name, value, options } of maybeRedirectTo !== null
      ? [maybeRedirectTo.updatedCookie]
      : []) {
      vheaders.append("Set-Cookie", serializeCookie(name, value, options));
    }
    return new Response(null, { status: 302, headers: vheaders });
  };

  const handleSamlSlo = async (
    ctx: GenericActionCtx<GenericDataModel>,
    request: Request,
    runtimeRoute: SSORuntimeRoute,
  ) => {
    type LogoutResponseContext = { context: string; entityEndpoint: string };
    if (
      runtimeRoute.protocol !== "saml" ||
      runtimeRoute.rest.length !== 1 ||
      runtimeRoute.rest[0] !== "slo"
    ) {
      throw convexError("INVALID_PARAMETERS", "Invalid connection runtime path.");
    }
    const { loaded, connection } = await loadActiveConnectionSamlOrThrow(
      ctx,
      runtimeRoute.connectionId,
    );
    const parsedMessage = await parseGroupConnectionSamlLogoutMessage({
      request,
      rootUrl: requireEnv("CONVEX_SITE_URL"),
      source: { kind: "connection", id: connection._id },
      config: loaded.config,
    });
    if (parsedMessage.hasSamlRequest) {
      if (!parsedMessage.parsedRequest) {
        throw convexError("INVALID_PARAMETERS", "Missing SAML logout payload.");
      }
      const responseContext = parsedMessage.runtime.sp.createLogoutResponse(
        parsedMessage.runtime.idp,
        parsedMessage.parsedRequest.extract,
        parsedMessage.binding,
        parsedMessage.relayState ?? "",
      ) as unknown as LogoutResponseContext;
      if (parsedMessage.binding === "redirect") {
        return new Response(null, {
          status: 302,
          headers: { Location: responseContext.context },
        });
      }
      return createSamlPostBindingResponse({
        endpoint: responseContext.entityEndpoint,
        parameter: "SAMLResponse",
        value: responseContext.context,
        relayState: parsedMessage.relayState,
      });
    } else if (parsedMessage.hasSamlResponse) {
      return new Response(null, { status: 204 });
    } else {
      throw convexError("INVALID_PARAMETERS", "Missing SAML logout payload.");
    }
  };

  const handleScimRequest = async (ctx: GenericActionCtx<GenericDataModel>, request: Request) => {
    try {
      const { scimConfig, connection, parsedPath } = await getGroupConnectionScimContext(
        ctx,
        request,
      );
      const url = new URL(request.url);
      const state: ScimState = {
        ctx,
        request,
        url,
        parsedPath,
        connection,
        scimConfig,
        policy: await loadGroupPolicyOrThrow(ctx, connection.groupId),
        recordScimEvent: async (eventType, ok, subjectType, subjectId, metadata) => {
          const auditEventId = await recordGroupAuditEvent(ctx, {
            connectionId: connection._id,
            groupId: connection.groupId,
            eventType,
            actorType: "scim",
            subjectType,
            subjectId,
            ok,
            metadata,
          });
          await emitGroupWebhookDeliveries(ctx, {
            connectionId: connection._id,
            eventType,
            auditEventId,
            payload: {
              connectionId: connection._id,
              subjectId,
              metadata,
            },
          });
        },
      };

      const handleUsersGet: ScimHandler = async (state) => {
        const members = await auth.member.list(state.ctx, {
          where: { groupId: state.connection.groupId },
          limit: 100,
        });
        const identities = await listScimIdentitiesByConnection(
          state.ctx,
          config.component.public,
          state.connection._id,
        );
        const identityByUserId = new Map(
          identities
            .filter(
              (identity: ScimIdentityRecord): identity is ScimIdentityRecord & { userId: string } =>
                typeof identity.userId === "string",
            )
            .map((identity: ScimIdentityRecord & { userId: string }) => [
              identity.userId,
              identity,
            ]),
        );
        const users = (
          await Promise.all(
            members.items.map(async (member) => {
              const user = await auth.user.get(state.ctx, member.userId);
              const typedUser = user as UserRecord | null;
              return user
                ? {
                    user: typedUser,
                    member,
                    identity: identityByUserId.get(typedUser!._id),
                  }
                : null;
            }),
          )
        ).filter(Boolean) as UserListItem[];
        const listRequest = parseScimListRequest(state.url);
        const filtered = filterScimCollection<UserListItem>(users, listRequest.filter, {
          id: (item) => item.user._id,
          externalId: (item) => item.identity?.externalId,
          userName: (item) => item.user.email ?? item.user.phone ?? item.user.name ?? item.user._id,
          displayName: (item) => item.user.name,
          name: (item) => item.user.name,
          "name.formatted": (item) => item.user.name,
          "name.givenName": (item) => item.user.name,
          "name.familyName": (item) => item.user.name,
          "emails.value": (item) => item.user.email,
          "phoneNumbers.value": (item) => item.user.phone,
          active: (item) => item.identity?.active ?? item.member.status === "active",
        });
        if (state.parsedPath.resourceId) {
          const resource = filtered.find(({ user }) => user._id === state.parsedPath.resourceId);
          return resource
            ? scimJson(
                serializeScimUser({
                  id: resource.user._id,
                  user: resource.user,
                  externalId: resource.identity?.externalId,
                  location: `${state.url.origin}${state.url.pathname.replace(/\/[^/]+$/, "")}/${resource.user._id}`,
                  active: resource.identity?.active ?? resource.member.status === "active",
                }),
                200,
                {
                  Location: `${state.url.origin}${state.url.pathname.replace(/\/[^/]+$/, "")}/${resource.user._id}`,
                },
              )
            : scimError(404, "notFound", "User not found.");
        }
        const paged = paginateScimCollection(filtered, listRequest);
        await state.recordScimEvent(
          "group.sso.scim.read",
          true,
          "group_connection_scim",
          state.scimConfig._id,
        );
        return scimJson({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
          Resources: paged.map(({ user, identity, member }) =>
            serializeScimUser({
              id: user._id,
              user,
              externalId: identity?.externalId,
              location: `${state.url.origin}${state.url.pathname}/${user._id}`,
              active: identity?.active ?? member.status === "active",
            }),
          ),
          totalResults: filtered.length,
          startIndex: listRequest.startIndex,
          itemsPerPage: paged.length,
        });
      };

      const handleUsersPost: ScimHandler = async (state) => {
        const body = (await readScimJson(state.request)) as ScimBody;
        const extractedBase = extractScimProfile(state.scimConfig, body);
        const extracted =
          ((await config.sso?.hooks?.profileResolved?.({
            protocol: "scim",
            connectionId: state.connection._id,
            profile: extractedBase as Record<string, unknown>,
          })) as typeof extractedBase | undefined) ?? extractedBase;
        const provisionProfile =
          ((await config.sso?.hooks?.beforeProvision?.({
            protocol: "scim",
            connectionId: state.connection._id,
            profile: extracted as Record<string, unknown>,
          })) as typeof extracted | undefined) ?? extracted;
        const externalId = provisionProfile.externalId;
        const existingIdentity = externalId
          ? await getScimIdentity(state.ctx, config.component.public, {
              connectionId: state.connection._id,
              resourceType: "user",
              externalId,
            })
          : null;
        const existingUser = existingIdentity?.userId
          ? await auth.user.get(state.ctx, existingIdentity.userId)
          : null;
        const created = existingUser === null;
        const provisionedRoleIds = resolveProvisionedRoleIds({
          policy: state.policy as any,
          groups: provisionProfile.groups,
          roles: provisionProfile.roles,
        });
        const userId = existingUser?._id
          ? existingUser._id
          : await insertUser(state.ctx, config.component.public, {
              name: provisionProfile.name,
              ...(typeof provisionProfile.firstName === "string"
                ? { firstName: provisionProfile.firstName }
                : {}),
              ...(typeof provisionProfile.lastName === "string"
                ? { lastName: provisionProfile.lastName }
                : {}),
              email: provisionProfile.email,
              ...(typeof provisionProfile.email === "string"
                ? { emailVerificationTime: Date.now() }
                : {}),
              phone: provisionProfile.phone,
              ...(typeof provisionProfile.phone === "string"
                ? { phoneVerificationTime: Date.now() }
                : {}),
              ...(provisionProfile.extend ? { extend: provisionProfile.extend } : {}),
            });
        if (created && externalId) {
          const providerId =
            state.connection.protocol === "oidc"
              ? groupOidcProviderId(state.connection._id)
              : groupSamlProviderId(state.connection._id);
          await insertAccount(state.ctx, config.component.public, {
            userId,
            provider: providerId,
            providerAccountId: externalId,
          });
        }
        if (existingUser) {
          const nextUserData: Record<string, unknown> = {
            name: provisionProfile.name,
            firstName: provisionProfile.firstName,
            lastName: provisionProfile.lastName,
            email: provisionProfile.email,
            phone: provisionProfile.phone,
            ...(provisionProfile.extend ? { extend: provisionProfile.extend } : {}),
          };
          if (typeof provisionProfile.email === "string") {
            nextUserData.emailVerificationTime = Date.now();
          }
          if (typeof provisionProfile.phone === "string") {
            nextUserData.phoneVerificationTime = Date.now();
          }
          const patchData = applyUserProvisioningPatch({
            currentUser: existingUser as Record<string, unknown>,
            nextUser: nextUserData,
            policy: state.policy.provisioning.user,
            source: "scim",
          });
          if (Object.keys(patchData).length > 0) {
            await patchUser(state.ctx, config.component.public, {
              userId,
              data: patchData,
            });
          }
        }
        const resolution = await auth.member.inspect(state.ctx, {
          groupId: state.connection.groupId,
          userId,
        });
        if (resolution.membership) {
          await auth.member.update(state.ctx, resolution.membership._id, {
            status: body.active === false ? "inactive" : "active",
          });
        } else {
          await auth.member.create(state.ctx, {
            groupId: state.connection.groupId,
            userId,
            roleIds: provisionedRoleIds,
            status: provisionProfile.active === false ? "inactive" : "active",
          });
        }
        if (externalId) {
          await upsertScimIdentity(state.ctx, config.component.public, {
            connectionId: state.connection._id,
            groupId: state.connection.groupId,
            resourceType: "user",
            externalId,
            userId,
            active: provisionProfile.active !== false,
            raw: body,
            lastProvisionedAt: Date.now(),
          });
        }
        await state.recordScimEvent(
          created ? "group.sso.scim.user.created" : "group.sso.scim.user.updated",
          true,
          "user",
          userId,
        );
        const createdUser = await auth.user.get(state.ctx, userId);
        await config.sso?.hooks?.afterProvision?.({
          protocol: "scim",
          connectionId: state.connection._id,
          profile: provisionProfile as Record<string, unknown>,
          userId,
        });
        const location = `${state.url.origin}${state.url.pathname}/${userId}`;
        return scimJson(
          serializeScimUser({
            id: userId,
            user: createdUser ?? {},
            externalId,
            location,
            active: provisionProfile.active !== false,
          }),
          created ? 201 : 200,
          { Location: location },
        );
      };

      const handleUsersUpsert: ScimHandler = async (state) => {
        const missing = requireScimResourceId(state.parsedPath.resourceId, "User");
        if (missing) return missing;
        const userId = state.parsedPath.resourceId!;
        const existingUser = await auth.user.get(state.ctx, userId);
        if (!existingUser) {
          return scimError(404, "notFound", "User not found.");
        }
        const body = (await readScimJson(state.request)) as ScimBody;
        const extractedBase = extractScimProfile(state.scimConfig, body);
        const extracted =
          ((await config.sso?.hooks?.profileResolved?.({
            protocol: "scim",
            connectionId: state.connection._id,
            profile: extractedBase as Record<string, unknown>,
          })) as typeof extractedBase | undefined) ?? extractedBase;
        const provisionProfile =
          ((await config.sso?.hooks?.beforeProvision?.({
            protocol: "scim",
            connectionId: state.connection._id,
            profile: extracted as Record<string, unknown>,
          })) as typeof extracted | undefined) ?? extracted;
        const externalId = provisionProfile.externalId;
        const patchData: Record<string, unknown> = {};
        let nextActive: boolean | undefined;
        if (state.request.method === "PUT") {
          patchData.name = provisionProfile.name;
          patchData.firstName = provisionProfile.firstName;
          patchData.lastName = provisionProfile.lastName;
          patchData.email = provisionProfile.email;
          patchData.phone = provisionProfile.phone;
          if (provisionProfile.extend) {
            patchData.extend = provisionProfile.extend;
          }
          if (typeof patchData.email === "string") {
            patchData.emailVerificationTime = Date.now();
          }
          if (typeof patchData.phone === "string") {
            patchData.phoneVerificationTime = Date.now();
          }
        } else {
          for (const operation of Array.isArray(body.Operations) ? body.Operations : []) {
            if (operation.path === "active") {
              nextActive = typeof operation.value === "boolean" ? operation.value : undefined;
            }
            if (operation.path === "displayName" || operation.path === "name.formatted") {
              patchData.name = operation.value;
            }
            if (operation.path === "name.givenName") {
              patchData.firstName = operation.value;
            }
            if (operation.path === "name.familyName") {
              patchData.lastName = operation.value;
            }
            if (operation.path === "userName" || operation.path === "emails.value") {
              patchData.email = operation.value;
              if (typeof operation.value === "string") {
                patchData.emailVerificationTime = Date.now();
              }
            }
            if (operation.path === "phoneNumbers.value") {
              patchData.phone = operation.value;
              if (typeof operation.value === "string") {
                patchData.phoneVerificationTime = Date.now();
              }
            }
          }
        }
        const nextPatchData = applyUserProvisioningPatch({
          currentUser: existingUser as Record<string, unknown>,
          nextUser: patchData,
          policy: state.policy.provisioning.user,
          source: "scim",
        });
        if (Object.keys(nextPatchData).length > 0) {
          await patchUser(state.ctx, config.component.public, {
            userId,
            data: nextPatchData,
          });
        }
        const resolution = await auth.member.inspect(state.ctx, {
          groupId: state.connection.groupId,
          userId,
        });
        if (resolution.membership) {
          await auth.member.update(state.ctx, resolution.membership._id, {
            roleIds: resolveProvisionedRoleIds({
              policy: state.policy as any,
              groups: provisionProfile.groups,
              roles: provisionProfile.roles,
            }),
            status:
              provisionProfile.active === false || nextActive === false ? "inactive" : "active",
          });
        }
        await upsertScimIdentity(state.ctx, config.component.public, {
          connectionId: state.connection._id,
          groupId: state.connection.groupId,
          resourceType: "user",
          externalId:
            externalId !== undefined
              ? externalId
              : ((
                  await getScimIdentityByConnectionAndUser(state.ctx, config.component.public, {
                    connectionId: state.connection._id,
                    userId,
                  })
                )?.externalId ?? userId),
          userId,
          active: provisionProfile.active !== false && nextActive !== false,
          raw: body,
          lastProvisionedAt: Date.now(),
        });
        await state.recordScimEvent("group.sso.scim.user.updated", true, "user", userId);
        const updatedUser = await auth.user.get(state.ctx, userId);
        await config.sso?.hooks?.afterProvision?.({
          protocol: "scim",
          connectionId: state.connection._id,
          profile: provisionProfile as Record<string, unknown>,
          userId,
        });
        const location = `${state.url.origin}${state.url.pathname}`;
        return scimJson(
          serializeScimUser({
            id: userId,
            user: updatedUser ?? existingUser,
            externalId,
            location,
            active: provisionProfile.active !== false && nextActive !== false,
          }),
          200,
          { Location: location },
        );
      };

      const handleUsersDelete: ScimHandler = async (state) => {
        const missing = requireScimResourceId(state.parsedPath.resourceId, "User");
        if (missing) return missing;
        const userId = state.parsedPath.resourceId!;
        const resolution = await auth.member.inspect(state.ctx, {
          groupId: state.connection.groupId,
          userId,
        });
        if (resolution.membership) {
          await auth.member.delete(state.ctx, resolution.membership._id);
        }
        const identity = await getScimIdentityByConnectionAndUser(
          state.ctx,
          config.component.public,
          {
            connectionId: state.connection._id,
            userId,
          },
        );
        if (identity) {
          if (state.policy.provisioning.deprovision.mode === "hard") {
            await deleteScimIdentity(state.ctx, config.component.public, identity._id);
          } else {
            await upsertScimIdentity(state.ctx, config.component.public, {
              connectionId: identity.connectionId,
              groupId: identity.groupId,
              resourceType: identity.resourceType,
              externalId: identity.externalId,
              userId: identity.userId,
              mappedGroupId: identity.mappedGroupId,
              active: false,
              raw: identity.raw,
              lastProvisionedAt: Date.now(),
            });
          }
        }
        await state.recordScimEvent("group.sso.scim.user.deleted", true, "user", userId);
        return new Response(null, { status: 204 });
      };

      const handleGroupsGet: ScimHandler = async (state) => {
        const groupsList = await auth.group.list(state.ctx, {
          where: { parentGroupId: state.connection.groupId },
          limit: 100,
        });
        const identities = await listScimIdentitiesByConnection(
          state.ctx,
          config.component.public,
          state.connection._id,
        );
        const identityByGroupId = new Map(
          identities
            .filter(
              (
                identity: ScimIdentityRecord,
              ): identity is ScimIdentityRecord & { mappedGroupId: string } =>
                typeof identity.mappedGroupId === "string",
            )
            .map((identity: ScimIdentityRecord & { mappedGroupId: string }) => [
              identity.mappedGroupId,
              identity,
            ]),
        );
        const groups: GroupListItem[] = await Promise.all(
          groupsList.items.map(async (group) => {
            const typedGroup = group as GroupRecord;
            const members = await auth.member.list(state.ctx, {
              where: { groupId: typedGroup._id, status: "active" },
              limit: 100,
            });
            return {
              group: typedGroup,
              identity: identityByGroupId.get(typedGroup._id),
              memberIds: members.items.map((member) => member.userId),
            };
          }),
        );
        const listRequest = parseScimListRequest(state.url);
        const filtered = filterScimCollection<GroupListItem>(groups, listRequest.filter, {
          id: (item) => item.group._id,
          externalId: (item) => item.identity?.externalId,
          displayName: (item) => item.group.name,
          "members.value": (item) => item.memberIds,
        });
        if (state.parsedPath.resourceId) {
          const resource = filtered.find(({ group }) => group._id === state.parsedPath.resourceId);
          if (!resource) {
            return scimError(404, "notFound", "Group not found.");
          }
          const members = (
            await auth.member.list(state.ctx, {
              where: {
                groupId: resource.group._id,
                status: "active",
              },
              limit: 100,
            })
          ).items.map((member) => ({ value: member.userId }));
          const location = `${state.url.origin}${state.url.pathname.replace(/\/[^/]+$/, "")}/${resource.group._id}`;
          return scimJson(
            serializeScimGroup({
              id: resource.group._id,
              group: resource.group,
              externalId: resource.identity?.externalId,
              location,
              members,
            }),
            200,
            { Location: location },
          );
        }
        const paged = paginateScimCollection(filtered, listRequest);
        return scimJson({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
          Resources: paged.map(({ group, identity }) =>
            serializeScimGroup({
              id: group._id,
              group,
              externalId: identity?.externalId,
              location: `${state.url.origin}${state.url.pathname}/${group._id}`,
            }),
          ),
          totalResults: filtered.length,
          startIndex: listRequest.startIndex,
          itemsPerPage: paged.length,
        });
      };

      const handleGroupsPost: ScimHandler = async (state) => {
        const body = await readScimJson(state.request);
        const externalId = typeof body.externalId === "string" ? body.externalId : undefined;
        const existingIdentity = externalId
          ? await getScimIdentity(state.ctx, config.component.public, {
              connectionId: state.connection._id,
              resourceType: "group",
              externalId,
            })
          : null;
        const existingGroup = existingIdentity?.mappedGroupId
          ? await auth.group.get(state.ctx, existingIdentity.mappedGroupId)
          : null;
        const created = existingGroup === null;
        const provisionedRoleIds = resolveProvisionedRoleIds({
          policy: state.policy as any,
          groups: typeof body.displayName === "string" ? [body.displayName] : undefined,
          roles: pickStringArray((body as Record<string, unknown>).roles),
        });
        const groupId = existingGroup?._id
          ? existingGroup._id
          : (
              await auth.group.create(state.ctx, {
                name: typeof body.displayName === "string" ? body.displayName : "Group",
                parentGroupId: state.connection.groupId,
                type: "organization",
              })
            ).groupId;
        if (!created && existingGroup) {
          const location = `${state.url.origin}${state.url.pathname}/${groupId}`;
          return scimJson(
            serializeScimGroup({
              id: groupId,
              group: existingGroup,
              externalId,
              location,
              members: (
                await auth.member.list(state.ctx, {
                  where: { groupId, status: "active" },
                  limit: 100,
                })
              ).items.map((member) => ({ value: member.userId })),
            }),
            200,
            { Location: location },
          );
        }
        await upsertScimIdentity(state.ctx, config.component.public, {
          connectionId: state.connection._id,
          groupId: state.connection.groupId,
          resourceType: "group",
          externalId: externalId ?? groupId,
          mappedGroupId: groupId,
          active: true,
          raw: body,
          lastProvisionedAt: Date.now(),
        });
        const currentMembers = (
          await auth.member.list(state.ctx, {
            where: { groupId, status: "active" },
            limit: 100,
          })
        ).items as Array<{ _id: string; userId: string }>;
        const currentByUserId = new Map(currentMembers.map((member) => [member.userId, member]));
        const nextUserIds = new Set(
          (Array.isArray(body.members) ? body.members : []).map((member) => String(member.value)),
        );
        for (const member of currentMembers) {
          if (!nextUserIds.has(member.userId)) {
            await auth.member.delete(state.ctx, member._id);
          }
        }
        for (const userId of nextUserIds.values()) {
          if (!currentByUserId.has(userId)) {
            try {
              await auth.member.create(state.ctx, {
                groupId,
                userId,
                roleIds: provisionedRoleIds,
                status: "active",
              });
            } catch {}
          }
        }
        await state.recordScimEvent(
          created ? "group.sso.scim.group.created" : "group.sso.scim.group.updated",
          true,
          "group",
          groupId,
        );
        const group = await auth.group.get(state.ctx, groupId);
        const location = `${state.url.origin}${state.url.pathname}/${groupId}`;
        return scimJson(
          serializeScimGroup({
            id: groupId,
            group: group ?? {},
            externalId,
            location,
            members: (
              await auth.member.list(state.ctx, {
                where: { groupId, status: "active" },
                limit: 100,
              })
            ).items.map((member) => ({ value: member.userId })),
          }),
          created ? 201 : 200,
          { Location: location },
        );
      };

      const handleGroupsPatch: ScimHandler = async (state) => {
        const missing = requireScimResourceId(state.parsedPath.resourceId, "Group");
        if (missing) return missing;
        const groupId = state.parsedPath.resourceId!;
        const body = await readScimJson(state.request);
        for (const operation of Array.isArray(body.Operations) ? body.Operations : []) {
          if (operation.path === "displayName") {
            await auth.group.update(state.ctx, groupId, {
              name: operation.value,
            });
          }
          if (operation.path === "members" && operation.op === "add") {
            for (const member of Array.isArray(operation.value) ? operation.value : []) {
              try {
                await auth.member.create(state.ctx, {
                  groupId,
                  userId: String(member.value),
                  roleIds: resolveProvisionedRoleIds({
                    policy: state.policy as any,
                    groups: typeof body.displayName === "string" ? [body.displayName] : undefined,
                    roles: pickStringArray((body as Record<string, unknown>).roles),
                  }),
                  status: "active",
                });
              } catch {}
            }
          }
          if (operation.path === "members" && operation.op === "replace") {
            const currentMembers = (
              await auth.member.list(state.ctx, {
                where: { groupId, status: "active" },
                limit: 100,
              })
            ).items as Array<{ _id: string; userId: string }>;
            const currentUserIds = new Set<string>(currentMembers.map((member) => member.userId));
            const nextUserIds = new Set<string>(
              (Array.isArray(operation.value) ? operation.value : []).map((member: unknown) =>
                String((member as { value?: unknown }).value),
              ),
            );
            for (const member of currentMembers) {
              if (!nextUserIds.has(member.userId)) {
                await auth.member.delete(state.ctx, member._id);
              }
            }
            for (const userId of nextUserIds.values()) {
              if (!currentUserIds.has(userId)) {
                try {
                  await auth.member.create(state.ctx, {
                    groupId,
                    userId,
                    roleIds: resolveProvisionedRoleIds({
                      policy: state.policy as any,
                      groups: typeof body.displayName === "string" ? [body.displayName] : undefined,
                      roles: pickStringArray((body as Record<string, unknown>).roles),
                    }),
                    status: "active",
                  });
                } catch {}
              }
            }
          }
          if (
            typeof operation.path === "string" &&
            operation.op === "remove" &&
            operation.path.startsWith("members[")
          ) {
            const match = operation.path.match(/^members\[value eq "([^"]+)"\]$/);
            const userId = match?.[1];
            if (userId) {
              const resolution = await auth.member.inspect(state.ctx, {
                groupId,
                userId,
              });
              if (resolution.membership) {
                await auth.member.delete(state.ctx, resolution.membership._id);
              }
            }
          }
        }
        await state.recordScimEvent("group.sso.scim.group.updated", true, "group", groupId);
        const group = await auth.group.get(state.ctx, groupId);
        const location = `${state.url.origin}${state.url.pathname}`;
        const members = (
          await auth.member.list(state.ctx, {
            where: { groupId, status: "active" },
            limit: 100,
          })
        ).items as Array<{ userId: string }>;
        return scimJson(
          serializeScimGroup({
            id: groupId,
            group: group ?? {},
            location,
            members: members.map((member) => ({
              value: member.userId,
            })),
          }),
          200,
          { Location: location },
        );
      };

      const handleGroupsDelete: ScimHandler = async (state) => {
        const missing = requireScimResourceId(state.parsedPath.resourceId, "Group");
        if (missing) return missing;
        const groupId = state.parsedPath.resourceId!;
        await auth.group.delete(state.ctx, groupId);
        const identity = await getScimIdentityByMappedGroup(
          state.ctx,
          config.component.public,
          groupId,
        );
        if (identity) {
          await deleteScimIdentity(state.ctx, config.component.public, identity._id);
        }
        await state.recordScimEvent("group.sso.scim.group.deleted", true, "group", groupId);
        return new Response(null, { status: 204 });
      };

      const scimHandlers: Record<string, Partial<Record<string, ScimHandler>>> = {
        ServiceProviderConfig: {
          GET: async () =>
            scimJson({
              schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
              patch: { supported: true },
              bulk: {
                supported: false,
                maxOperations: 0,
                maxPayloadSize: 0,
              },
              filter: { supported: true, maxResults: 100 },
              changePassword: { supported: false },
              sort: { supported: false },
              etag: { supported: false },
              authenticationSchemes: [
                {
                  type: "oauthbearertoken",
                  name: "Bearer Token",
                  description: "Use the SCIM token generated by Convex Auth connection.",
                },
              ],
            }),
        },
        Schemas: {
          GET: async (state) =>
            handleStaticScimCollection(SCIM_SCHEMAS, state.parsedPath.resourceId, {
              by: "id",
              notFound: "Schema not found.",
            }),
        },
        ResourceTypes: {
          GET: async (state) =>
            handleStaticScimCollection(SCIM_RESOURCE_TYPES, state.parsedPath.resourceId, {
              by: "name",
              notFound: "Resource type not found.",
            }),
        },
        Users: {
          GET: handleUsersGet,
          POST: handleUsersPost,
          PATCH: handleUsersUpsert,
          PUT: handleUsersUpsert,
          DELETE: handleUsersDelete,
        },
        Groups: {
          GET: handleGroupsGet,
          POST: handleGroupsPost,
          PATCH: handleGroupsPatch,
          DELETE: handleGroupsDelete,
        },
      };

      const handler = scimHandlers[state.parsedPath.resource]?.[state.request.method];
      return handler
        ? await handler(state)
        : scimError(404, "notFound", "SCIM resource not found.");
    } catch (error) {
      if (error instanceof Error && error.message === "Unsupported SCIM filter.") {
        return scimError(400, "invalidFilter", error.message);
      }
      if (
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "code" in error.data &&
        "message" in error.data
      ) {
        const code = error.data.code as string;
        const status = code === "MISSING_BEARER_TOKEN" || code === "INVALID_API_KEY" ? 401 : 400;
        return scimError(status, code, error.data.message);
      }
      throw error;
    }
  };

  const handleOidcCallbackForConnection = async (
    ctx: GenericActionCtx<GenericDataModel>,
    request: Request,
    connectionId: string,
  ) => {
    const url = new URL(request.url);
    const { connection, oidc } = await loadConnectionOidcOrThrow(ctx, connectionId);
    const { providerId, provider, oauthConfig } = await createGroupConnectionOidcRuntime({
      rootUrl: requireEnv("CONVEX_SITE_URL"),
      connectionId: connection._id,
      oidc,
      sharedRedirectURI: sharedOidcRedirectURI,
    });
    const cookies = getCookies(request);
    const maybeRedirectTo = useRedirectToParam(providerId, cookies);
    const destinationUrl = await redirectAbsoluteUrl(config, {
      redirectTo: maybeRedirectTo?.redirectTo,
    });
    const result = await handleOAuthCallback(
      providerId,
      { ...oauthConfig, provider },
      Object.fromEntries(url.searchParams.entries()),
      cookies,
    );
    const extraFields =
      typeof oidc.profile === "object" && oidc.profile !== null
        ? ((oidc.profile as Record<string, unknown>).extraFields as
            | Record<string, string>
            | undefined)
        : undefined;
    let profile = result.profile as Record<string, unknown>;
    if (extraFields && typeof profile === "object" && profile) {
      const extend: Record<string, unknown> = {};
      for (const [claimName, fieldName] of Object.entries(extraFields)) {
        if (claimName in profile) {
          extend[fieldName] = profile[claimName];
        }
      }
      if (Object.keys(extend).length > 0) {
        profile = { ...profile, extend };
      }
    }

    const verificationCode = await callUserOAuth(ctx, {
      provider: providerId,
      providerAccountId: result.providerAccountId,
      profile: profile as AuthProfile,
      signature: result.signature,
      accountExtend: {
        identity: {
          protocol: "oidc",
          connectionId: connection._id,
          subject: result.providerAccountId,
          issuer:
            typeof (oidc.discovery as Record<string, unknown> | undefined)?.issuer === "string"
              ? ((oidc.discovery as Record<string, unknown>).issuer as string)
              : undefined,
          discoveryUrl:
            typeof (oidc.discovery as Record<string, unknown> | undefined)?.discoveryUrl ===
            "string"
              ? ((oidc.discovery as Record<string, unknown>).discoveryUrl as string)
              : undefined,
        },
      },
    });
    const headers = new Headers({
      Location: setURLSearchParam(destinationUrl, "code", verificationCode),
    });
    for (const { name, value, options } of result.cookies) {
      headers.append("Set-Cookie", serializeCookie(name, value, options));
    }
    if (maybeRedirectTo) {
      headers.append(
        "Set-Cookie",
        serializeCookie(
          maybeRedirectTo.updatedCookie.name,
          maybeRedirectTo.updatedCookie.value,
          maybeRedirectTo.updatedCookie.options,
        ),
      );
    }
    return new Response(null, { status: 302, headers });
  };

  addSSORoutes(http, {
    routeBase: GROUP_CONNECTION_ROUTE_BASE,
    convertErrorsToResponse,
    handleSamlMetadata: async (ctx, _request, runtimeRoute) => {
      const { loaded } = await loadActiveConnectionSamlOrThrow(ctx, runtimeRoute.connectionId);
      return new Response(
        createGroupConnectionSamlMetadataXml({
          rootUrl: requireEnv("CONVEX_SITE_URL"),
          source: loaded.source,
          config: loaded.config,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        },
      );
    },
    handleSamlSignIn: async (ctx, request, runtimeRoute) => {
      const url = new URL(request.url);
      const verifier = url.searchParams.get("code");
      if (!verifier) {
        throw convexError("OAUTH_MISSING_VERIFIER", "Missing sign-in verifier.");
      }
      const { loaded, connection } = await loadActiveConnectionSamlOrThrow(
        ctx,
        runtimeRoute.connectionId,
      );
      const state = generateRandomString(24, INVITE_TOKEN_ALPHABET);
      const signInRequest = createGroupConnectionSamlSignInRequest({
        rootUrl: requireEnv("CONVEX_SITE_URL"),
        source: { kind: "connection", id: connection._id },
        config: loaded.config,
        state,
        signature: `saml ${connection._id} pending ${state}`,
        redirectTo: url.searchParams.get("redirectTo") ?? undefined,
      });
      const signature = `saml ${connection._id} ${signInRequest.requestId} ${state}`;
      await callVerifierSignature(ctx, { verifier, signature });
      const redirectTo = url.searchParams.get("redirectTo");
      const redirectCookies =
        redirectTo !== null
          ? [redirectToParamCookie(groupSamlProviderId(connection._id), redirectTo)]
          : [];
      const relayState = encodeGroupSamlRelayState({
        source: { kind: "connection", id: connection._id },
        signature,
        requestId: signInRequest.requestId,
        state,
        redirectTo: url.searchParams.get("redirectTo") ?? undefined,
      });
      if (signInRequest.binding === "redirect" && signInRequest.redirectUrl) {
        const redirectUrl = new URL(signInRequest.redirectUrl);
        redirectUrl.searchParams.set("RelayState", relayState);
        const headers = new Headers({
          Location: redirectUrl.toString(),
        });
        for (const { name, value, options } of redirectCookies as CookieToSerialize[]) {
          headers.append("Set-Cookie", serializeCookie(name, value, options));
        }
        return new Response(null, { status: 302, headers });
      }
      const response = createSamlPostBindingResponse({
        endpoint: signInRequest.post!.endpoint,
        parameter: "SAMLRequest",
        value: signInRequest.post!.value,
        relayState,
      });
      for (const { name, value, options } of redirectCookies as CookieToSerialize[]) {
        response.headers.append("Set-Cookie", serializeCookie(name, value, options));
      }
      return response;
    },
    handleOidcSignIn: async (ctx, request, runtimeRoute) => {
      const url = new URL(request.url);
      const verifier = url.searchParams.get("code");
      if (!verifier) {
        throw convexError("OAUTH_MISSING_VERIFIER", "Missing sign-in verifier.");
      }
      const { connection, oidc } = await loadConnectionOidcOrThrow(ctx, runtimeRoute.connectionId);
      const { providerId, provider, oauthConfig } = await createGroupConnectionOidcRuntime({
        rootUrl: requireEnv("CONVEX_SITE_URL"),
        connectionId: connection._id,
        oidc,
        sharedRedirectURI: sharedOidcRedirectURI,
      });
      const { redirect, cookies, signature } = await createOAuthAuthorizationURL(
        providerId,
        {
          ...oauthConfig,
          provider,
        },
        {
          loginHint:
            url.searchParams.get("loginHint") ??
            (typeof (oidc.request as Record<string, unknown> | undefined)?.loginHint === "string"
              ? ((oidc.request as Record<string, unknown>).loginHint as string)
              : undefined),
          stateTransform:
            typeof sharedOidcRedirectURI === "string"
              ? (state) =>
                  encodeGroupOidcState({
                    connectionId: connection._id,
                    state,
                  })
              : undefined,
        },
      );
      await callVerifierSignature(ctx, { verifier, signature });
      const redirectTo = url.searchParams.get("redirectTo");
      const headers_ = new Headers({ Location: redirect });
      for (const { name, value, options } of [
        ...cookies,
        ...(redirectTo !== null ? [redirectToParamCookie(providerId, redirectTo)] : []),
      ] as CookieToSerialize[]) {
        headers_.append("Set-Cookie", serializeCookie(name, value, options));
      }
      return new Response(null, {
        status: 302,
        headers: headers_,
      });
    },
    handleOidcCallback: async (ctx, request, runtimeRoute) => {
      return await handleOidcCallbackForConnection(ctx, request, runtimeRoute.connectionId);
    },
    handleSamlAcs,
    handleSamlSlo,
    handleScimRequest,
    sharedOidcCallbackPath: sharedOidcRedirectURI,
    handleOidcSharedCallback: async (ctx, request) => {
      const url = new URL(request.url);
      const params = await getOidcCallbackParams(request);
      const { connectionId, state } = decodeGroupOidcState(params.get("state"));
      params.set("state", state);
      url.search = params.toString();
      const normalizedRequest = new Request(url, request);
      return await handleOidcCallbackForConnection(ctx, normalizedRequest, connectionId);
    },
    scimError,
  });
}
