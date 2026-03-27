import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import type { GenericActionCtx, HttpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { serialize as serializeCookie } from "cookie";

import { redirectToParamCookie, useRedirectToParam } from "../cookies";
import { addSSORoutes, convertErrorsToResponse, getCookies } from "../http";
import type { SSORuntimeRoute } from "../http";
import { createOAuthAuthorizationURL, handleOAuthCallback } from "../oauth";
import { redirectAbsoluteUrl, setURLSearchParam } from "../redirects";
import { createEnterpriseOidcRuntime } from "./oidc";
import {
  createEnterpriseSamlMetadataXml,
  createEnterpriseSamlSignInRequest,
  createSamlPostBindingResponse,
  encodeEnterpriseSamlRelayState,
  parseEnterpriseSamlLoginResponse,
  parseEnterpriseSamlLogoutMessage,
  profileFromSamlExtract,
  validateEnterpriseSamlLoginRelayState,
} from "./saml";
import {
  parseScimListRequest,
  scimError,
  scimJson,
  serializeScimGroup,
  serializeScimUser,
} from "./scim";
import {
  enterpriseSamlProviderId,
  SCIM_GROUP_SCHEMA_ID,
  SCIM_USER_SCHEMA_ID,
} from "./shared";

export type EnterpriseHttpRuntimeDeps = {
  http: HttpRouter;
  hasSSO: boolean;
  auth: any;
  config: any;
  routeBase: string;
  requireEnv: (name: string) => string;
  loadActiveEnterpriseSamlOrThrow: any;
  loadEnterpriseOidcOrThrow: any;
  getEnterpriseScimContext: any;
  getPolicyFromEnterprise: any;
  normalizeEnterprisePolicy: any;
  recordEnterpriseAuditEvent: any;
  emitEnterpriseWebhookDeliveries: any;
  generateRandomString: (length: number, alphabet: string) => string;
  inviteTokenAlphabet: string;
  callUserOAuth: any;
  callVerifierSignature: any;
};

export function addEnterpriseHttpRuntime(deps: EnterpriseHttpRuntimeDeps) {
  if (!deps.hasSSO) {
    return;
  }

  const {
    http,
    auth,
    config,
    requireEnv,
    loadActiveEnterpriseSamlOrThrow,
    loadEnterpriseOidcOrThrow,
    getEnterpriseScimContext,
    getPolicyFromEnterprise,
    recordEnterpriseAuditEvent,
    emitEnterpriseWebhookDeliveries,
    generateRandomString,
    inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
    callUserOAuth,
    callVerifierSignature,
  } = deps;
  const ENTERPRISE_CONTROL_ROUTE_BASE = deps.routeBase;

  type ScimState = {
    ctx: any;
    request: Request;
    url: URL;
    parsedPath: Awaited<
      ReturnType<typeof getEnterpriseScimContext>
    >["parsedPath"];
    enterprise: Awaited<
      ReturnType<typeof getEnterpriseScimContext>
    >["enterprise"];
    scimConfig: Awaited<
      ReturnType<typeof getEnterpriseScimContext>
    >["scimConfig"];
    policy: any;
    recordScimEvent: (
      eventType: string,
      ok: boolean,
      subjectType: string,
      subjectId?: string,
      metadata?: Record<string, unknown>,
    ) => Promise<void>;
  };

  type ScimHandler = (state: ScimState) => Promise<Response>;

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
      const item = items.find(
        (entry) => entry[opts.by] === decodeURIComponent(resourceId),
      );
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

  const filterScimCollection = <T>(
    items: T[],
    filter: ReturnType<typeof parseScimListRequest>["filter"],
    filters: Record<string, (item: T, value: string) => boolean>,
  ) => {
    if (!filter) {
      return items;
    }
    const predicate = filters[filter.attribute];
    if (!predicate) {
      throw new Error("Unsupported SCIM filter.");
    }
    return items.filter((item) => predicate(item, filter.value));
  };

  const paginateScimCollection = <T>(
    items: T[],
    listRequest: ReturnType<typeof parseScimListRequest>,
  ) => {
    const start = listRequest.startIndex - 1;
    return items.slice(start, start + listRequest.count);
  };

  const requireScimResourceId = (
    resourceId: string | undefined,
    label: string,
  ) => {
    if (!resourceId) {
      return scimError(400, "invalidPath", `${label} resource ID is required.`);
    }
    return null;
  };

  const readScimJson = async (request: Request) =>
    (await request.json()) as Record<string, any>;

  const handleSamlAcs = async (
    ctx: GenericActionCtx<any>,
    request: Request,
    runtimeRoute: SSORuntimeRoute,
  ) =>
    Fx.run(
      Fx.gen(function* () {
        yield* Fx.guard(
          runtimeRoute.protocol !== "saml" ||
            runtimeRoute.rest.length !== 1 ||
            runtimeRoute.rest[0] !== "acs",
          Cv.fail({
            code: "INVALID_PARAMETERS",
            message: "Invalid enterprise runtime path.",
          }),
        );

        const enterpriseId = runtimeRoute.enterpriseId;
        const { loaded, enterprise, saml } = yield* Fx.from({
          ok: () => loadActiveEnterpriseSamlOrThrow(ctx, enterpriseId),
          err: (e) => e,
        });

        const parsedResponse = yield* Fx.from({
          ok: () =>
            parseEnterpriseSamlLoginResponse({
              request,
              rootUrl: requireEnv("CONVEX_SITE_URL"),
              source: { kind: "enterprise", id: enterprise._id },
              config: loaded.config,
            }),
          err: (e) =>
            Cv.error({
              code: "OAUTH_PROVIDER_ERROR",
              message: `SAML response parse failed: ${e instanceof Error ? e.message : String(e)}`,
            }),
        });

        yield* Fx.from({
          ok: () => {
            validateEnterpriseSamlLoginRelayState({
              relayState: parsedResponse.relayState,
              source: { kind: "enterprise", id: enterprise._id },
              inResponseTo:
                parsedResponse.parsed.extract?.response?.inResponseTo,
            });
            return Promise.resolve();
          },
          err: () =>
            Cv.error({
              code: "OAUTH_INVALID_STATE",
              message:
                "SAML RelayState did not match the pending login request.",
            }),
        });

        const { samlAttributes, samlSessionIndex, ...userProfile } =
          profileFromSamlExtract(
            parsedResponse.parsed.extract,
            saml.attributeMapping,
          );
        const profile = userProfile as Record<string, unknown> & {
          id: string;
        };

        const maybeRedirectTo = useRedirectToParam(
          enterpriseSamlProviderId(enterprise._id),
          getCookies(request),
        );

        const verificationCode = yield* Fx.from({
          ok: () =>
            callUserOAuth(ctx, {
              provider: enterpriseSamlProviderId(enterprise._id),
              providerAccountId: profile.id,
              profile,
              signature: parsedResponse.relayState.signature,
              accountExtend: {
                identity: {
                  protocol: "saml",
                  enterpriseId: enterprise._id,
                  subject: profile.id,
                  entityId:
                    typeof saml.entityId === "string"
                      ? saml.entityId
                      : undefined,
                },
                saml: {
                  attributes: samlAttributes,
                  sessionIndex: samlSessionIndex,
                },
              },
            }),
          err: (e) => e,
        });

        const destinationUrl = yield* Fx.from({
          ok: () =>
            redirectAbsoluteUrl(config, {
              redirectTo:
                maybeRedirectTo?.redirectTo ??
                (typeof parsedResponse.relayState.redirectTo === "string"
                  ? parsedResponse.relayState.redirectTo
                  : undefined),
            }),
          err: (e) => e,
        });

        const vurl = setURLSearchParam(
          destinationUrl,
          "code",
          verificationCode,
        );
        const vheaders = new Headers({ Location: vurl });
        vheaders.set("Cache-Control", "must-revalidate");
        for (const { name, value, options } of maybeRedirectTo !== null
          ? [maybeRedirectTo.updatedCookie]
          : []) {
          vheaders.append("Set-Cookie", serializeCookie(name, value, options));
        }
        return new Response(null, { status: 302, headers: vheaders });
      }).pipe(Fx.recover((e) => Fx.fatal(e))),
    );

  const handleSamlSlo = async (
    ctx: GenericActionCtx<any>,
    request: Request,
    runtimeRoute: SSORuntimeRoute,
  ) => {
    if (
      runtimeRoute.protocol !== "saml" ||
      runtimeRoute.rest.length !== 1 ||
      runtimeRoute.rest[0] !== "slo"
    ) {
      throw Cv.error({
        code: "INVALID_PARAMETERS",
        message: "Invalid enterprise runtime path.",
      });
    }
    const { loaded, enterprise } = await loadActiveEnterpriseSamlOrThrow(
      ctx,
      runtimeRoute.enterpriseId,
    );
    const parsedMessage = await parseEnterpriseSamlLogoutMessage({
      request,
      rootUrl: requireEnv("CONVEX_SITE_URL"),
      source: { kind: "enterprise", id: enterprise._id },
      config: loaded.config,
    });
    if (parsedMessage.hasSamlRequest && parsedMessage.parsedRequest) {
      const responseContext = (
        parsedMessage.runtime.sp as any
      ).createLogoutResponse(
        parsedMessage.runtime.idp as any,
        parsedMessage.parsedRequest.extract,
        parsedMessage.binding as any,
        parsedMessage.relayState ?? "",
      ) as any;
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
    }
    if (parsedMessage.hasSamlResponse) {
      return new Response(null, { status: 204 });
    }
    throw Cv.error({
      code: "INVALID_PARAMETERS",
      message: "Missing SAML logout payload.",
    });
  };

  const handleScimRequest = async (
    ctx: GenericActionCtx<any>,
    request: Request,
  ) => {
    try {
      const { scimConfig, enterprise, parsedPath } =
        await getEnterpriseScimContext(ctx, request);
      const url = new URL(request.url);
      const state: ScimState = {
        ctx,
        request,
        url,
        parsedPath,
        enterprise,
        scimConfig,
        policy: getPolicyFromEnterprise(enterprise),
        recordScimEvent: async (
          eventType,
          ok,
          subjectType,
          subjectId,
          metadata,
        ) => {
          const auditEventId = await recordEnterpriseAuditEvent(ctx, {
            enterpriseId: enterprise._id,
            groupId: enterprise.groupId,
            eventType,
            actorType: "scim",
            subjectType,
            subjectId,
            ok,
            metadata,
          });
          await emitEnterpriseWebhookDeliveries(ctx, {
            enterpriseId: enterprise._id,
            eventType,
            auditEventId,
            payload: {
              enterpriseId: enterprise._id,
              subjectId,
              metadata,
            },
          });
        },
      };

      const handleUsersGet: ScimHandler = async (state) => {
        const members = await auth.member.list(state.ctx, {
          where: { groupId: state.enterprise.groupId },
          limit: 100,
        });
        const identities = await state.ctx.runQuery(
          config.component.public.enterpriseScimIdentityListByEnterprise,
          { enterpriseId: state.enterprise._id },
        );
        const identityByUserId = new Map(
          identities
            .filter((identity: any) => identity.userId !== undefined)
            .map((identity: any) => [identity.userId, identity]),
        );
        const users = (
          await Promise.all(
            members.items.map(async (member: any) => {
              const user = await auth.user.get(state.ctx, member.userId);
              return user
                ? {
                    user,
                    member,
                    identity: identityByUserId.get(user._id),
                  }
                : null;
            }),
          )
        ).filter(Boolean) as Array<{
          user: any;
          member: any;
          identity?: any;
        }>;
        const listRequest = parseScimListRequest(state.url);
        const filtered = filterScimCollection(users, listRequest.filter, {
          id: (item: { user: any }, value: string) => item.user._id === value,
          externalId: (item: { identity?: any }, value: string) =>
            item.identity?.externalId === value,
          userName: (item: { user: any }, value: string) =>
            item.user.email === value,
          "emails.value": (item: { user: any }, value: string) =>
            item.user.email === value,
          active: (item: { identity?: any; member: any }, value: string) =>
            String(item.identity?.active ?? item.member.status === "active") ===
            value,
        });
        if (state.parsedPath.resourceId) {
          const resource = filtered.find(
            ({ user }) => user._id === state.parsedPath.resourceId,
          );
          return resource
            ? scimJson(
                serializeScimUser({
                  id: resource.user._id,
                  user: resource.user,
                  externalId: resource.identity?.externalId,
                  location: `${state.url.origin}${state.url.pathname.replace(/\/[^/]+$/, "")}/${resource.user._id}`,
                  active:
                    resource.identity?.active ??
                    resource.member.status === "active",
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
          "enterprise.scim.read",
          true,
          "enterprise_scim",
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
        const body = await readScimJson(state.request);
        const primaryEmail = Array.isArray(body.emails)
          ? (body.emails.find((entry) => entry.primary === true)?.value ??
            body.emails[0]?.value)
          : undefined;
        const phone = Array.isArray(body.phoneNumbers)
          ? body.phoneNumbers[0]?.value
          : undefined;
        const userId = (await state.ctx.runMutation(
          config.component.public.userInsert,
          {
            data: {
              name: body.displayName ?? body.name?.formatted,
              email: primaryEmail ?? body.userName,
              ...(typeof (primaryEmail ?? body.userName) === "string"
                ? { emailVerificationTime: Date.now() }
                : {}),
              phone,
              ...(typeof phone === "string"
                ? { phoneVerificationTime: Date.now() }
                : {}),
            },
          },
        )) as string;
        try {
          await auth.member.create(state.ctx, {
            groupId: state.enterprise.groupId,
            userId,
            roleIds: state.policy.provisioning.jit.defaultRoleIds,
            status: body.active === false ? "inactive" : "active",
          });
        } catch {}
        if (typeof body.externalId === "string") {
          await state.ctx.runMutation(
            config.component.public.enterpriseScimIdentityUpsert,
            {
              enterpriseId: state.enterprise._id,
              groupId: state.enterprise.groupId,
              resourceType: "user",
              externalId: body.externalId,
              userId,
              active: body.active !== false,
              raw: body,
              lastProvisionedAt: Date.now(),
            },
          );
        }
        await state.recordScimEvent(
          "enterprise.scim.user.created",
          true,
          "user",
          userId,
        );
        const createdUser = await auth.user.get(state.ctx, userId);
        const location = `${state.url.origin}${state.url.pathname}/${userId}`;
        return scimJson(
          serializeScimUser({
            id: userId,
            user: createdUser ?? {},
            externalId: body.externalId,
            location,
            active: body.active !== false,
          }),
          201,
          { Location: location },
        );
      };

      const handleUsersUpsert: ScimHandler = async (state) => {
        const missing = requireScimResourceId(
          state.parsedPath.resourceId,
          "User",
        );
        if (missing) return missing;
        const userId = state.parsedPath.resourceId!;
        const existingUser = await auth.user.get(state.ctx, userId);
        if (!existingUser) {
          return scimError(404, "notFound", "User not found.");
        }
        const body = await readScimJson(state.request);
        const patchData: Record<string, unknown> = {};
        let nextActive: boolean | undefined;
        if (state.request.method === "PUT") {
          patchData.name = body.displayName ?? body.name?.formatted;
          patchData.email =
            body.userName ??
            (Array.isArray(body.emails) ? body.emails[0]?.value : undefined);
          patchData.phone = Array.isArray(body.phoneNumbers)
            ? body.phoneNumbers[0]?.value
            : undefined;
          if (typeof patchData.email === "string") {
            patchData.emailVerificationTime = Date.now();
          }
          if (typeof patchData.phone === "string") {
            patchData.phoneVerificationTime = Date.now();
          }
        } else {
          for (const operation of Array.isArray(body.Operations)
            ? body.Operations
            : []) {
            if (operation.path === "active") {
              nextActive = operation.value;
            }
            if (
              operation.path === "displayName" ||
              operation.path === "name.formatted"
            ) {
              patchData.name = operation.value;
            }
            if (
              operation.path === "userName" ||
              operation.path === "emails.value"
            ) {
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
        await state.ctx.runMutation(config.component.public.userPatch, {
          userId,
          data: patchData,
        });
        const resolution = await auth.member.inspect(state.ctx, {
          groupId: state.enterprise.groupId,
          userId,
        });
        if (resolution.membership) {
          await auth.member.update(state.ctx, resolution.membership._id, {
            status:
              body.active === false || nextActive === false
                ? "inactive"
                : "active",
          });
        }
        await state.ctx.runMutation(
          config.component.public.enterpriseScimIdentityUpsert,
          {
            enterpriseId: state.enterprise._id,
            groupId: state.enterprise.groupId,
            resourceType: "user",
            externalId:
              typeof body.externalId === "string"
                ? body.externalId
                : ((
                    await state.ctx.runQuery(
                      config.component.public
                        .enterpriseScimIdentityGetByEnterpriseAndUser,
                      {
                        enterpriseId: state.enterprise._id,
                        userId,
                      },
                    )
                  )?.externalId ?? userId),
            userId,
            active: body.active !== false && nextActive !== false,
            raw: body,
            lastProvisionedAt: Date.now(),
          },
        );
        await state.recordScimEvent(
          "enterprise.scim.user.updated",
          true,
          "user",
          userId,
        );
        const updatedUser = await auth.user.get(state.ctx, userId);
        const location = `${state.url.origin}${state.url.pathname}`;
        return scimJson(
          serializeScimUser({
            id: userId,
            user: updatedUser ?? existingUser,
            externalId:
              typeof body.externalId === "string" ? body.externalId : undefined,
            location,
            active: body.active !== false && nextActive !== false,
          }),
          200,
          { Location: location },
        );
      };

      const handleUsersDelete: ScimHandler = async (state) => {
        const missing = requireScimResourceId(
          state.parsedPath.resourceId,
          "User",
        );
        if (missing) return missing;
        const userId = state.parsedPath.resourceId!;
        const resolution = await auth.member.inspect(state.ctx, {
          groupId: state.enterprise.groupId,
          userId,
        });
        if (resolution.membership) {
          await auth.member.delete(state.ctx, resolution.membership._id);
        }
        const identity = await state.ctx.runQuery(
          config.component.public.enterpriseScimIdentityGetByEnterpriseAndUser,
          {
            enterpriseId: state.enterprise._id,
            userId,
          },
        );
        if (identity) {
          if (state.policy.provisioning.deprovision.mode === "hard") {
            await state.ctx.runMutation(
              config.component.public.enterpriseScimIdentityDelete,
              { identityId: identity._id },
            );
          } else {
            await state.ctx.runMutation(
              config.component.public.enterpriseScimIdentityUpsert,
              {
                enterpriseId: identity.enterpriseId,
                groupId: identity.groupId,
                resourceType: identity.resourceType,
                externalId: identity.externalId,
                userId: identity.userId,
                mappedGroupId: identity.mappedGroupId,
                active: false,
                raw: identity.raw,
                lastProvisionedAt: Date.now(),
              },
            );
          }
        }
        await state.recordScimEvent(
          "enterprise.scim.user.deleted",
          true,
          "user",
          userId,
        );
        return new Response(null, { status: 204 });
      };

      const handleGroupsGet: ScimHandler = async (state) => {
        const groupsList = await auth.group.list(state.ctx, {
          where: { parentGroupId: state.enterprise.groupId },
          limit: 100,
        });
        const identities = await state.ctx.runQuery(
          config.component.public.enterpriseScimIdentityListByEnterprise,
          { enterpriseId: state.enterprise._id },
        );
        const identityByGroupId = new Map(
          identities
            .filter((identity: any) => identity.mappedGroupId !== undefined)
            .map((identity: any) => [identity.mappedGroupId, identity]),
        );
        const groups = groupsList.items.map((group: any) => ({
          group,
          identity: identityByGroupId.get(group._id),
        }));
        const listRequest = parseScimListRequest(state.url);
        const filtered = filterScimCollection<{
          group: any;
          identity?: any;
        }>(groups, listRequest.filter, {
          id: (item: { group: any }, value: string) => item.group._id === value,
          externalId: (item: { identity?: any }, value: string) =>
            item.identity?.externalId === value,
          displayName: (item: { group: any }, value: string) =>
            item.group.name === value,
        });
        if (state.parsedPath.resourceId) {
          const resource = filtered.find(
            ({ group }) => group._id === state.parsedPath.resourceId,
          );
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
          ).items.map((member: any) => ({ value: member.userId }));
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
        const { groupId } = await auth.group.create(state.ctx, {
          name: String(body.displayName ?? "Group"),
          parentGroupId: state.enterprise.groupId,
          type: "organization",
        });
        await state.ctx.runMutation(
          config.component.public.enterpriseScimIdentityUpsert,
          {
            enterpriseId: state.enterprise._id,
            groupId: state.enterprise.groupId,
            resourceType: "group",
            externalId: body.externalId ?? groupId,
            mappedGroupId: groupId,
            active: true,
            raw: body,
            lastProvisionedAt: Date.now(),
          },
        );
        for (const member of Array.isArray(body.members) ? body.members : []) {
          try {
            await auth.member.create(state.ctx, {
              groupId,
              userId: String(member.value),
              roleIds: state.policy.provisioning.jit.defaultRoleIds,
              status: "active",
            });
          } catch {}
        }
        await state.recordScimEvent(
          "enterprise.scim.group.created",
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
            externalId: body.externalId,
            location,
            members: (
              await auth.member.list(state.ctx, {
                where: { groupId, status: "active" },
                limit: 100,
              })
            ).items.map((member: any) => ({ value: member.userId })),
          }),
          201,
          { Location: location },
        );
      };

      const handleGroupsPatch: ScimHandler = async (state) => {
        const missing = requireScimResourceId(
          state.parsedPath.resourceId,
          "Group",
        );
        if (missing) return missing;
        const groupId = state.parsedPath.resourceId!;
        const body = await readScimJson(state.request);
        for (const operation of Array.isArray(body.Operations)
          ? body.Operations
          : []) {
          if (operation.path === "displayName") {
            await auth.group.update(state.ctx, groupId, {
              name: operation.value,
            });
          }
          if (operation.path === "members" && operation.op === "add") {
            for (const member of Array.isArray(operation.value)
              ? operation.value
              : []) {
              try {
                await auth.member.create(state.ctx, {
                  groupId,
                  userId: String(member.value),
                  roleIds: state.policy.provisioning.jit.defaultRoleIds,
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
            const currentUserIds = new Set<string>(
              currentMembers.map((member) => member.userId),
            );
            const nextUserIds = new Set<string>(
              (Array.isArray(operation.value) ? operation.value : []).map(
                (member: any) => String(member.value),
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
                    roleIds: state.policy.provisioning.jit.defaultRoleIds,
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
            const match = operation.path.match(
              /^members\[value eq "([^"]+)"\]$/,
            );
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
        await state.recordScimEvent(
          "enterprise.scim.group.updated",
          true,
          "group",
          groupId,
        );
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
        const missing = requireScimResourceId(
          state.parsedPath.resourceId,
          "Group",
        );
        if (missing) return missing;
        const groupId = state.parsedPath.resourceId!;
        await auth.group.delete(state.ctx, groupId);
        const identity = await state.ctx.runQuery(
          config.component.public.enterpriseScimIdentityGetByMappedGroup,
          { mappedGroupId: groupId },
        );
        if (identity) {
          await state.ctx.runMutation(
            config.component.public.enterpriseScimIdentityDelete,
            { identityId: identity._id },
          );
        }
        await state.recordScimEvent(
          "enterprise.scim.group.deleted",
          true,
          "group",
          groupId,
        );
        return new Response(null, { status: 204 });
      };

      const scimHandlers: Record<
        string,
        Partial<Record<string, ScimHandler>>
      > = {
        ServiceProviderConfig: {
          GET: async () =>
            scimJson({
              schemas: [
                "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
              ],
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
                  description:
                    "Use the SCIM token generated by Convex Auth enterprise.",
                },
              ],
            }),
        },
        Schemas: {
          GET: async (state) =>
            handleStaticScimCollection(
              SCIM_SCHEMAS,
              state.parsedPath.resourceId,
              {
                by: "id",
                notFound: "Schema not found.",
              },
            ),
        },
        ResourceTypes: {
          GET: async (state) =>
            handleStaticScimCollection(
              SCIM_RESOURCE_TYPES,
              state.parsedPath.resourceId,
              { by: "name", notFound: "Resource type not found." },
            ),
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

      const handler =
        scimHandlers[state.parsedPath.resource]?.[state.request.method];
      return handler
        ? await handler(state)
        : scimError(404, "notFound", "SCIM resource not found.");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Unsupported SCIM filter."
      ) {
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
        const status =
          code === "MISSING_BEARER_TOKEN" || code === "INVALID_API_KEY"
            ? 401
            : 400;
        return scimError(status, code, error.data.message);
      }
      throw error;
    }
  };

  addSSORoutes(http, {
    routeBase: ENTERPRISE_CONTROL_ROUTE_BASE,
    convertErrorsToResponse,
    handleSamlMetadata: async (ctx, _request, runtimeRoute) => {
      const { loaded } = await loadActiveEnterpriseSamlOrThrow(
        ctx,
        runtimeRoute.enterpriseId,
      );
      return new Response(
        createEnterpriseSamlMetadataXml({
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
        throw Cv.error({
          code: "OAUTH_MISSING_VERIFIER",
          message: "Missing sign-in verifier.",
        });
      }
      const { loaded, enterprise } = await loadActiveEnterpriseSamlOrThrow(
        ctx,
        runtimeRoute.enterpriseId,
      );
      const state = generateRandomString(24, INVITE_TOKEN_ALPHABET);
      const signInRequest = createEnterpriseSamlSignInRequest({
        rootUrl: requireEnv("CONVEX_SITE_URL"),
        source: { kind: "enterprise", id: enterprise._id },
        config: loaded.config,
        state,
        signature: `saml ${enterprise._id} pending ${state}`,
        redirectTo: url.searchParams.get("redirectTo") ?? undefined,
      });
      const signature = `saml ${enterprise._id} ${signInRequest.requestId} ${state}`;
      await callVerifierSignature(ctx, { verifier, signature });
      const redirectTo = url.searchParams.get("redirectTo");
      const redirectCookies =
        redirectTo !== null
          ? [
              redirectToParamCookie(
                enterpriseSamlProviderId(enterprise._id),
                redirectTo,
              ),
            ]
          : [];
      const relayState = encodeEnterpriseSamlRelayState({
        source: { kind: "enterprise", id: enterprise._id },
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
        for (const { name, value, options } of redirectCookies as any) {
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
      for (const { name, value, options } of redirectCookies as any) {
        response.headers.append(
          "Set-Cookie",
          serializeCookie(name, value, options),
        );
      }
      return response;
    },
    handleOidcSignIn: async (ctx, request, runtimeRoute) => {
      const url = new URL(request.url);
      const verifier = url.searchParams.get("code");
      if (!verifier) {
        throw Cv.error({
          code: "OAUTH_MISSING_VERIFIER",
          message: "Missing sign-in verifier.",
        });
      }
      const { enterprise, oidc } = await loadEnterpriseOidcOrThrow(
        ctx,
        runtimeRoute.enterpriseId,
      );
      const { providerId, provider, oauthConfig } =
        await createEnterpriseOidcRuntime({
          rootUrl: requireEnv("CONVEX_SITE_URL"),
          enterpriseId: enterprise._id,
          oidc,
        });
      const { redirect, cookies, signature } =
        await createOAuthAuthorizationURL(providerId, provider, oauthConfig);
      await callVerifierSignature(ctx, { verifier, signature });
      const redirectTo = url.searchParams.get("redirectTo");
      const headers_ = new Headers({ Location: redirect });
      for (const { name, value, options } of [
        ...cookies,
        ...(redirectTo !== null
          ? [redirectToParamCookie(providerId, redirectTo)]
          : []),
      ] as any) {
        headers_.append("Set-Cookie", serializeCookie(name, value, options));
      }
      return new Response(null, {
        status: 302,
        headers: headers_,
      });
    },
    handleOidcCallback: async (ctx, request, runtimeRoute) => {
      const url = new URL(request.url);
      const { enterprise, oidc } = await loadEnterpriseOidcOrThrow(
        ctx,
        runtimeRoute.enterpriseId,
      );
      const { providerId, provider, oauthConfig } =
        await createEnterpriseOidcRuntime({
          rootUrl: requireEnv("CONVEX_SITE_URL"),
          enterpriseId: enterprise._id,
          oidc,
        });
      const cookies = getCookies(request);
      const maybeRedirectTo = useRedirectToParam(providerId, cookies);
      const destinationUrl = await redirectAbsoluteUrl(config, {
        redirectTo: maybeRedirectTo?.redirectTo,
      });
      const params = url.searchParams;
      const result = (await Fx.run(
        handleOAuthCallback(
          providerId,
          provider,
          oauthConfig,
          Object.fromEntries(params.entries()),
          cookies,
        ),
      )) as any;
      const extraFields = oidc.extraFields as
        | Record<string, string>
        | undefined;
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
        profile,
        signature: result.signature,
        accountExtend: {
          identity: {
            protocol: "oidc",
            enterpriseId: enterprise._id,
            subject: result.providerAccountId,
            issuer: typeof oidc.issuer === "string" ? oidc.issuer : undefined,
            discoveryUrl:
              typeof oidc.discoveryUrl === "string"
                ? oidc.discoveryUrl
                : undefined,
          },
        },
      });
      const headers = new Headers({
        Location: setURLSearchParam(destinationUrl, "code", verificationCode),
      });
      for (const { name, value, options } of result.cookies) {
        headers.append(
          "Set-Cookie",
          serializeCookie(name, value, options as any),
        );
      }
      if (maybeRedirectTo) {
        headers.append(
          "Set-Cookie",
          serializeCookie(
            maybeRedirectTo.updatedCookie.name,
            maybeRedirectTo.updatedCookie.value,
            maybeRedirectTo.updatedCookie.options as any,
          ),
        );
      }
      return new Response(null, { status: 302, headers });
    },
    handleSamlAcs,
    handleSamlSlo,
    handleScimRequest,
    scimError,
  });
}
