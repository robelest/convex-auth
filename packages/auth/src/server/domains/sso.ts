import { GenericActionCtx, GenericDataModel } from "convex/server";

import { AuthError, Fx } from "../fx";
import type { EnterprisePolicyPatch } from "../types";

type ComponentCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
type ComponentReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;

/**
 * Build the enterprise and SSO management domain.
 */
export function createSsoDomain(deps: any) {
  const {
    config,
    normalizeEnterprisePolicy,
    normalizeDomain,
    getEnterpriseSecret,
    loadEnterpriseOrThrow,
    validateEnterprisePolicy,
    recordEnterpriseAuditEvent,
    emitEnterpriseWebhookDeliveries,
    enterpriseNotFoundError,
    ENTERPRISE_OIDC_CLIENT_SECRET_KIND,
    requireEnv,
    generateRandomString,
    INVITE_TOKEN_ALPHABET,
    sha256,
    encryptSecret,
    upsertProtocolConfig,
    parseSamlIdpMetadata,
    createServiceProviderMetadata,
    getSamlServiceProviderOptions,
    getPublicOidcConfig,
    withOidcSecretState,
    getOidcConfig,
    getEnterpriseOidcUrls,
    enterpriseOidcProviderId,
    getPolicyFromEnterprise,
    patchEnterprisePolicy,
  } = deps;

  return {
    connection: {
      create: async (
        ctx: ComponentCtx,
        data: {
          groupId: string;
          slug?: string;
          name?: string;
          status?: "draft" | "active" | "disabled";
          policy?: EnterprisePolicyPatch;
          config?: Record<string, unknown>;
          extend?: Record<string, unknown>;
        },
      ): Promise<string> => {
        return (await ctx.runMutation(
          config.component.public.enterpriseCreate,
          {
            ...data,
            policy: normalizeEnterprisePolicy(data.policy),
          },
        )) as string;
      },
      get: async (ctx: ComponentReadCtx, enterpriseId: string) => {
        return await ctx.runQuery(config.component.public.enterpriseGet, {
          enterpriseId,
        });
      },
      getByGroup: async (ctx: ComponentReadCtx, groupId: string) => {
        return await ctx.runQuery(
          config.component.public.enterpriseGetByGroup,
          {
            groupId,
          },
        );
      },
      getByDomain: async (ctx: ComponentReadCtx, domain: string) => {
        return await ctx.runQuery(
          config.component.public.enterpriseGetByDomain,
          {
            domain: normalizeDomain(domain),
          },
        );
      },
      list: async (
        ctx: ComponentReadCtx,
        opts?: {
          where?: {
            groupId?: string;
            slug?: string;
            status?: "draft" | "active" | "disabled";
          };
          limit?: number;
          cursor?: string | null;
          orderBy?: "_creationTime" | "name" | "slug" | "status";
          order?: "asc" | "desc";
        },
      ) => {
        return await ctx.runQuery(config.component.public.enterpriseList, {
          where: opts?.where,
          limit: opts?.limit,
          cursor: opts?.cursor,
          orderBy: opts?.orderBy,
          order: opts?.order,
        });
      },
      update: async (
        ctx: ComponentCtx,
        enterpriseId: string,
        data: Record<string, unknown>,
      ) => {
        await ctx.runMutation(config.component.public.enterpriseUpdate, {
          enterpriseId,
          data,
        });
      },
      remove: async (ctx: ComponentCtx, enterpriseId: string) => {
        await ctx.runMutation(config.component.public.enterpriseDelete, {
          enterpriseId,
        });
      },
      /**
       * Aggregate readiness status across all configured protocols for an
       * enterprise connection.
       *
       * Returns a structured result indicating whether the connection is
       * ready, with per-protocol checks so callers can surface actionable
       * diagnostics without running full network validation.
       */
      status: async (ctx: ComponentReadCtx, enterpriseId: string) => {
        const enterprise = await ctx.runQuery(
          config.component.public.enterpriseGet,
          { enterpriseId },
        );
        if (!enterprise) {
          throw new AuthError(
            "INVALID_PARAMETERS",
            enterpriseNotFoundError,
          ).toConvexError();
        }
        const policy = getPolicyFromEnterprise(enterprise);
        const protocols = enterprise.config?.protocols ?? {};
        const oidcConfig = protocols.oidc;
        const oidcSecret = await getEnterpriseSecret(
          ctx,
          enterprise._id,
          ENTERPRISE_OIDC_CLIENT_SECRET_KIND,
        );
        const samlConfig = protocols.saml;
        const scimConfig = await ctx.runQuery(
          config.component.public.enterpriseScimConfigGetByEnterprise,
          { enterpriseId },
        );
        const domains = await ctx.runQuery(
          config.component.public.enterpriseDomainList,
          { enterpriseId },
        );

        const oidcReady =
          oidcConfig?.enabled === true &&
          typeof oidcConfig?.clientId === "string" &&
          oidcConfig.clientId.length > 0 &&
          oidcSecret !== null &&
          (typeof oidcConfig?.issuer === "string" ||
            typeof oidcConfig?.discoveryUrl === "string");
        const samlReady =
          samlConfig?.enabled === true &&
          typeof samlConfig?.idp?.entityId === "string";
        const scimReady =
          scimConfig !== null &&
          scimConfig !== undefined &&
          (scimConfig as any).status === "active";

        const ready =
          enterprise.status === "active" && (oidcReady || samlReady);

        return {
          enterpriseId: enterprise._id,
          status: enterprise.status,
          ready,
          domainCount: (domains as unknown[]).length,
          protocols: {
            oidc: {
              configured: oidcReady,
              ready: oidcReady,
              clientId: oidcConfig?.clientId ?? null,
              issuer: oidcConfig?.issuer ?? oidcConfig?.discoveryUrl ?? null,
            },
            saml: {
              configured: samlReady,
              ready: samlReady,
              entityId: samlConfig?.idp?.entityId ?? null,
            },
            scim: {
              configured: scimReady,
              ready: scimReady,
              basePath: scimConfig?.basePath ?? null,
              deprovisionMode: policy.provisioning.deprovision.mode,
            },
          },
        };
      },
    },
    domain: {
      add: async (
        ctx: ComponentCtx,
        data: {
          enterpriseId: string;
          groupId: string;
          domain: string;
          isPrimary?: boolean;
          verifiedAt?: number;
        },
      ): Promise<string> => {
        return (await ctx.runMutation(
          config.component.public.enterpriseDomainAdd,
          {
            ...data,
            domain: normalizeDomain(data.domain),
          },
        )) as string;
      },
      list: async (ctx: ComponentReadCtx, enterpriseId: string) => {
        return await ctx.runQuery(
          config.component.public.enterpriseDomainList,
          {
            enterpriseId,
          },
        );
      },
      remove: async (ctx: ComponentCtx, domainId: string) => {
        await ctx.runMutation(config.component.public.enterpriseDomainDelete, {
          domainId,
        });
      },
    },
    saml: {
      configure: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        data: {
          enterpriseId: string;
          metadataXml?: string;
          metadataUrl?: string;
          domains?: string[];
          signAuthnRequests?: boolean;
          attributeMapping?: {
            subject?: string;
            email?: string;
            name?: string;
            firstName?: string;
            lastName?: string;
          };
          sp?: {
            entityId?: string;
            acsUrl?: string;
            sloUrl?: string;
            signingCert?: string | string[];
            encryptCert?: string | string[];
            privateKey?: string;
            privateKeyPass?: string;
            encPrivateKey?: string;
            encPrivateKeyPass?: string;
          };
        },
      ) => {
        return await Fx.run(
          Fx.gen(function* () {
            const enterprise = yield* Fx.from({
              ok: () =>
                ctx.runQuery(config.component.public.enterpriseGet, {
                  enterpriseId: data.enterpriseId,
                }),
              err: () =>
                new AuthError("INTERNAL_ERROR", "Failed to load enterprise."),
            }).pipe(
              Fx.chain((ent) =>
                ent === null
                  ? Fx.fail(
                      new AuthError(
                        "INVALID_PARAMETERS",
                        enterpriseNotFoundError,
                      ),
                    )
                  : Fx.succeed(ent),
              ),
            );
            const metadataXml = yield* data.metadataXml
              ? Fx.succeed(data.metadataXml)
              : data.metadataUrl
                ? Fx.defer(() =>
                    Fx.from({
                      ok: async () => {
                        const response = await fetch(data.metadataUrl!);
                        if (!response.ok) {
                          throw new Error(
                            `Failed to fetch SAML metadata: ${response.status}`,
                          );
                        }
                        return await response.text();
                      },
                      err: (error) =>
                        new AuthError(
                          "INVALID_PARAMETERS",
                          error instanceof Error
                            ? error.message
                            : "Failed to fetch SAML metadata",
                        ),
                    }),
                  ).pipe(
                    Fx.timeout(10_000),
                    Fx.retry(
                      Fx.retry.compose(
                        Fx.retry.jittered(Fx.retry.exponential(200)),
                        Fx.retry.recurs(2),
                      ),
                    ),
                    Fx.recover((error) =>
                      Fx.fail(
                        new AuthError(
                          "INVALID_PARAMETERS",
                          error instanceof Error
                            ? error.message
                            : "Failed to fetch SAML metadata",
                        ),
                      ),
                    ),
                  )
                : Fx.fail(
                    new AuthError(
                      "INVALID_PARAMETERS",
                      "SAML registration requires metadataXml or metadataUrl.",
                    ),
                  );

            const parsed = yield* Fx.from({
              ok: () => parseSamlIdpMetadata(metadataXml),
              err: () =>
                new AuthError(
                  "INVALID_PARAMETERS",
                  "Failed to parse SAML metadata.",
                ),
            });

            const baseConfig = upsertProtocolConfig(enterprise.config, "saml", {
              enabled: true,
              idp: {
                metadataXml,
                ...parsed,
              },
              sp: data.sp,
              signAuthnRequests:
                data.signAuthnRequests ?? parsed.wantsSignedAuthnRequests,
              attributeMapping: data.attributeMapping,
            });
            const normalizedDomains = data.domains?.map(normalizeDomain);
            const nextConfig = normalizedDomains
              ? { ...baseConfig, domains: normalizedDomains }
              : baseConfig;

            yield* Fx.from({
              ok: () =>
                ctx.runMutation(config.component.public.enterpriseUpdate, {
                  enterpriseId: enterprise._id,
                  data: {
                    status: "active",
                    config: nextConfig,
                  },
                }),
              err: () =>
                new AuthError(
                  "INTERNAL_ERROR",
                  "Failed to persist SAML registration.",
                ),
            });

            if (normalizedDomains) {
              for (const [index, domain] of normalizedDomains.entries()) {
                yield* Fx.from({
                  ok: () =>
                    ctx.runMutation(
                      config.component.public.enterpriseDomainAdd,
                      {
                        enterpriseId: enterprise._id,
                        groupId: enterprise.groupId,
                        domain,
                        isPrimary: index === 0,
                      },
                    ),
                  err: () =>
                    new AuthError(
                      "INTERNAL_ERROR",
                      "Failed to persist enterprise domain.",
                    ),
                });
              }
            }

            yield* Fx.from({
              ok: () =>
                recordEnterpriseAuditEvent(ctx, {
                  enterpriseId: enterprise._id,
                  groupId: enterprise.groupId,
                  eventType: "enterprise.saml.registered",
                  actorType: "system",
                  subjectType: "enterprise_saml",
                  subjectId: enterprise._id,
                  ok: true,
                  metadata: {
                    metadataUrl: data.metadataUrl,
                    domains: normalizedDomains,
                  },
                }),
              err: () =>
                new AuthError(
                  "INTERNAL_ERROR",
                  "Failed to record SAML registration audit event.",
                ),
            });

            return {
              enterpriseId: enterprise._id,
              groupId: enterprise.groupId,
            };
          }).pipe(Fx.recover((e) => Fx.fatal(e.toConvexError()))),
        );
      },
      metadata: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        opts: {
          enterpriseId: string;
          entityId?: string;
          acsUrl?: string;
          sloUrl?: string;
        },
      ) => {
        const enterprise = await ctx.runQuery(
          config.component.public.enterpriseGet,
          {
            enterpriseId: opts.enterpriseId,
          },
        );
        if (!enterprise) {
          throw new AuthError(
            "INVALID_PARAMETERS",
            "Enterprise not found.",
          ).toConvexError();
        }

        return createServiceProviderMetadata(
          getSamlServiceProviderOptions({
            rootUrl: requireEnv("CONVEX_SITE_URL"),
            source: { kind: "enterprise", id: enterprise._id },
            config: enterprise.config,
            overrides: {
              entityId: opts.entityId,
              acsUrl: opts.acsUrl,
              sloUrl: opts.sloUrl,
            },
          }),
        );
      },
      /**
       * Validate the stored SAML config for an enterprise connection.
       *
       * Re-parses IdP metadata, checks signing cert presence, and verifies
       * SP metadata can be generated. Returns a structured result with
       * per-check details rather than throwing on first failure.
       */
      validate: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        enterpriseId: string,
      ) => {
        const checks: Array<{
          name: string;
          ok: boolean;
          message?: string;
        }> = [];

        const enterprise = await ctx.runQuery(
          config.component.public.enterpriseGet,
          { enterpriseId },
        );

        if (!enterprise) {
          return {
            ok: false,
            enterpriseId,
            checks: [
              {
                name: "enterprise_exists",
                ok: false,
                message: "Enterprise not found.",
              },
            ],
          };
        }

        const samlConfig = enterprise.config?.protocols?.saml;
        const samlConfigured =
          samlConfig?.enabled === true &&
          typeof samlConfig?.idp?.metadataXml === "string";

        checks.push({
          name: "saml_configured",
          ok: samlConfigured,
          message: samlConfigured ? undefined : "SAML is not configured.",
        });

        const hasIdpMetadata =
          typeof samlConfig?.idp?.metadataXml === "string" &&
          samlConfig.idp.metadataXml.length > 0;
        checks.push({
          name: "idp_metadata_present",
          ok: hasIdpMetadata,
          message: hasIdpMetadata ? undefined : "IdP metadata XML is missing.",
        });

        const hasEntityId =
          typeof samlConfig?.idp?.entityId === "string" &&
          samlConfig.idp.entityId.length > 0;
        checks.push({
          name: "idp_entity_id",
          ok: hasEntityId,
          message: hasEntityId
            ? undefined
            : "IdP entityId could not be parsed from metadata.",
        });

        let spMetadataOk = false;
        let spMetadataMessage: string | undefined;
        if (samlConfigured) {
          try {
            createServiceProviderMetadata(
              getSamlServiceProviderOptions({
                rootUrl: requireEnv("CONVEX_SITE_URL"),
                source: { kind: "enterprise", id: enterprise._id },
                config: enterprise.config,
                overrides: {},
              }),
            );
            spMetadataOk = true;
          } catch (e) {
            spMetadataMessage =
              e instanceof Error ? e.message : "SP metadata generation failed.";
          }
        } else {
          spMetadataMessage = "Skipped — SAML not configured.";
        }
        checks.push({
          name: "sp_metadata_generates",
          ok: spMetadataOk,
          message: spMetadataMessage,
        });

        return {
          ok: checks.every((c) => c.ok),
          enterpriseId: enterprise._id,
          checks,
        };
      },
    },
    policy: {
      get: async (ctx: ComponentReadCtx, enterpriseId: string) => {
        const enterprise = await loadEnterpriseOrThrow(ctx, enterpriseId);
        return getPolicyFromEnterprise(enterprise);
      },
      update: async (
        ctx: ComponentCtx,
        enterpriseId: string,
        patch: EnterprisePolicyPatch,
      ) => {
        const enterprise = await loadEnterpriseOrThrow(ctx, enterpriseId);
        const policy = patchEnterprisePolicy(enterprise.policy, patch);
        await ctx.runMutation(config.component.public.enterpriseUpdate, {
          enterpriseId,
          data: { policy },
        });
        await recordEnterpriseAuditEvent(ctx, {
          enterpriseId: enterprise._id,
          groupId: enterprise.groupId,
          eventType: "enterprise.policy.updated",
          actorType: "system",
          subjectType: "enterprise_policy",
          subjectId: enterprise._id,
          ok: true,
          metadata: { version: policy.version },
        });
        return policy;
      },
      validate: async (ctx: ComponentReadCtx, enterpriseId: string) => {
        const enterprise = await ctx.runQuery(
          config.component.public.enterpriseGet,
          { enterpriseId },
        );
        if (!enterprise) {
          return {
            ok: false,
            enterpriseId,
            checks: [
              {
                name: "enterprise_exists",
                ok: false,
                message: enterpriseNotFoundError,
              },
            ],
          };
        }
        const policy = getPolicyFromEnterprise(enterprise);
        const checks = validateEnterprisePolicy(policy);
        return {
          ok: checks.every((check: { ok: boolean }) => check.ok),
          enterpriseId,
          policy,
          checks,
        };
      },
    },
    oidc: {
      /**
       * Register or update enterprise OIDC connection settings.
       *
       * Persists protocol config under `enterprise.config.protocols.oidc` and
       * records an `enterprise.oidc.registered` audit event.
       */
      configure: async (
        ctx: ComponentCtx,
        data: {
          enterpriseId: string;
          issuer?: string;
          discoveryUrl?: string;
          clientId: string;
          clientSecret?: string;
          scopes?: string[];
          authorizationParams?: Record<string, string>;
          clockToleranceSeconds?: number;
          strictIssuer?: boolean;
          /**
           * Map OIDC claim names to `user.extend` field names.
           * Example: `{ department: "department", role: "job_title" }` means
           * the OIDC `department` claim is stored as `user.extend.department`.
           */
          extraFields?: Record<string, string>;
        },
      ) => {
        return await Fx.run(
          Fx.gen(function* () {
            yield* Fx.guard(
              data.issuer === undefined && data.discoveryUrl === undefined,
              Fx.fail(
                new AuthError(
                  "INVALID_PARAMETERS",
                  "OIDC registration requires issuer or discoveryUrl.",
                ),
              ),
            );

            const enterprise = yield* Fx.from({
              ok: () =>
                ctx.runQuery(config.component.public.enterpriseGet, {
                  enterpriseId: data.enterpriseId,
                }),
              err: () =>
                new AuthError("INTERNAL_ERROR", "Failed to load enterprise."),
            }).pipe(
              Fx.chain((ent) =>
                ent === null
                  ? Fx.fail(
                      new AuthError(
                        "INVALID_PARAMETERS",
                        enterpriseNotFoundError,
                      ),
                    )
                  : Fx.succeed(ent),
              ),
            );
            const nextConfig = upsertProtocolConfig(enterprise.config, "oidc", {
              enabled: true,
              issuer: data.issuer,
              discoveryUrl: data.discoveryUrl,
              clientId: data.clientId,
              scopes: data.scopes ?? ["openid", "profile", "email"],
              authorizationParams: data.authorizationParams,
              clockToleranceSeconds: data.clockToleranceSeconds,
              strictIssuer: data.strictIssuer,
              extraFields: data.extraFields,
            });

            yield* Fx.from({
              ok: () =>
                ctx.runMutation(config.component.public.enterpriseUpdate, {
                  enterpriseId: data.enterpriseId,
                  data: { config: nextConfig },
                }),
              err: () =>
                new AuthError(
                  "INTERNAL_ERROR",
                  "Failed to persist OIDC registration.",
                ),
            });

            if (data.clientSecret !== undefined) {
              const ciphertext = yield* Fx.from({
                ok: () => encryptSecret(data.clientSecret!),
                err: () =>
                  new AuthError(
                    "INTERNAL_ERROR",
                    "Failed to encrypt OIDC client secret.",
                  ),
              });
              yield* Fx.from({
                ok: () =>
                  ctx.runMutation(
                    config.component.public.enterpriseSecretUpsert,
                    {
                      enterpriseId: data.enterpriseId,
                      groupId: enterprise.groupId,
                      kind: ENTERPRISE_OIDC_CLIENT_SECRET_KIND,
                      ciphertext,
                      updatedAt: Date.now(),
                    },
                  ),
                err: () =>
                  new AuthError(
                    "INTERNAL_ERROR",
                    "Failed to persist OIDC client secret.",
                  ),
              });
            }

            yield* Fx.from({
              ok: () =>
                recordEnterpriseAuditEvent(ctx, {
                  enterpriseId: data.enterpriseId,
                  groupId: enterprise.groupId,
                  eventType: "enterprise.oidc.registered",
                  actorType: "system",
                  subjectType: "enterprise_oidc",
                  subjectId: data.enterpriseId,
                  ok: true,
                  metadata: {
                    issuer: data.issuer,
                    discoveryUrl: data.discoveryUrl,
                  },
                }),
              err: () =>
                new AuthError(
                  "INTERNAL_ERROR",
                  "Failed to record OIDC registration audit event.",
                ),
            });

            const secret = yield* Fx.from({
              ok: () =>
                getEnterpriseSecret(
                  ctx,
                  data.enterpriseId,
                  ENTERPRISE_OIDC_CLIENT_SECRET_KIND,
                ),
              err: () =>
                new AuthError(
                  "INTERNAL_ERROR",
                  "Failed to load OIDC secret metadata.",
                ),
            });

            return withOidcSecretState(
              getPublicOidcConfig(nextConfig),
              secret !== null,
            );
          }).pipe(Fx.recover((e) => Fx.fatal(e.toConvexError()))),
        );
      },
      /**
       * Fetch the stored OIDC config for an enterprise.
       */
      get: async (ctx: ComponentReadCtx, enterpriseId: string) => {
        return await Fx.run(
          Fx.from({
            ok: () =>
              ctx.runQuery(config.component.public.enterpriseGet, {
                enterpriseId,
              }),
            err: () =>
              new AuthError("INTERNAL_ERROR", "Failed to load enterprise."),
          }).pipe(
            Fx.chain((ent) =>
              ent === null
                ? Fx.fail(
                    new AuthError(
                      "INVALID_PARAMETERS",
                      enterpriseNotFoundError,
                    ),
                  )
                : Fx.succeed(ent),
            ),
            Fx.chain((enterprise) =>
              Fx.from({
                ok: async () => {
                  const secret = await getEnterpriseSecret(
                    ctx,
                    enterprise._id,
                    ENTERPRISE_OIDC_CLIENT_SECRET_KIND,
                  );
                  return withOidcSecretState(
                    getPublicOidcConfig(enterprise.config),
                    secret !== null,
                  );
                },
                err: () =>
                  new AuthError(
                    "INTERNAL_ERROR",
                    "Failed to load OIDC secret metadata.",
                  ),
              }),
            ),
            Fx.recover((e) => Fx.fatal(e.toConvexError())),
          ),
        );
      },
      /**
       * Resolve enterprise OIDC sign-in route from enterprise id, domain, or
       * user email domain.
       */
      resolveSignIn: async (
        ctx: ComponentReadCtx,
        data: {
          enterpriseId?: string;
          email?: string;
          domain?: string;
          redirectTo?: string;
        },
      ) => {
        return await Fx.run(
          Fx.gen(function* () {
            const enterprise =
              data.enterpriseId !== undefined
                ? yield* Fx.from({
                    ok: () =>
                      ctx.runQuery(config.component.public.enterpriseGet, {
                        enterpriseId: data.enterpriseId,
                      }),
                    err: () =>
                      new AuthError(
                        "INTERNAL_ERROR",
                        "Failed to load enterprise.",
                      ),
                  }).pipe(
                    Fx.chain((ent) =>
                      ent === null
                        ? Fx.fail(
                            new AuthError(
                              "INVALID_PARAMETERS",
                              enterpriseNotFoundError,
                            ),
                          )
                        : Fx.succeed(ent),
                    ),
                  )
                : data.domain !== undefined || data.email !== undefined
                  ? yield* Fx.from({
                      ok: () =>
                        ctx.runQuery(
                          config.component.public.enterpriseGetByDomain,
                          {
                            domain: normalizeDomain(
                              data.domain ??
                                String(data.email).split("@").at(-1) ??
                                "",
                            ),
                          },
                        ),
                      err: () =>
                        new AuthError(
                          "INTERNAL_ERROR",
                          "Failed to resolve enterprise by domain.",
                        ),
                    }).pipe(
                      Fx.chain((result) =>
                        result?.enterprise
                          ? Fx.succeed(result.enterprise)
                          : Fx.fail(
                              new AuthError(
                                "INVALID_PARAMETERS",
                                "No enterprise OIDC connection matched the provided input.",
                              ),
                            ),
                      ),
                    )
                  : yield* Fx.fail(
                      new AuthError(
                        "INVALID_PARAMETERS",
                        "No enterprise OIDC connection matched the provided input.",
                      ),
                    );

            yield* Fx.guard(
              enterprise.status !== "active",
              Fx.fail(
                new AuthError(
                  "INVALID_PARAMETERS",
                  "Enterprise connection is not active.",
                ),
              ),
            );

            const oidc = getOidcConfig(enterprise.config);
            yield* Fx.guard(
              oidc.enabled !== true,
              Fx.fail(
                new AuthError(
                  "PROVIDER_NOT_CONFIGURED",
                  "OIDC is not configured for this enterprise.",
                ),
              ),
            );

            const urls = getEnterpriseOidcUrls({
              rootUrl: requireEnv("CONVEX_SITE_URL"),
              enterpriseId: enterprise._id,
            });
            return {
              enterpriseId: enterprise._id,
              providerId: enterpriseOidcProviderId(enterprise._id),
              signInPath: urls.signInUrl,
              callbackPath: urls.callbackUrl,
              redirectTo: data.redirectTo,
            };
          }).pipe(Fx.recover((e) => Fx.fatal(e.toConvexError()))),
        );
      },
      /**
       * Validate the stored OIDC config for an enterprise connection.
       *
       * Fetches the OIDC discovery document from the configured issuer or
       * discoveryUrl, verifies required fields are present, and checks that
       * clientId is set. Returns a structured result with per-check details.
       */
      validate: async (ctx: ComponentReadCtx, enterpriseId: string) => {
        const checks: Array<{
          name: string;
          ok: boolean;
          message?: string;
        }> = [];

        const enterprise = await ctx.runQuery(
          config.component.public.enterpriseGet,
          { enterpriseId },
        );

        if (!enterprise) {
          return {
            ok: false,
            enterpriseId,
            checks: [
              {
                name: "enterprise_exists",
                ok: false,
                message: "Enterprise not found.",
              },
            ],
          };
        }

        const oidc = getOidcConfig(enterprise.config);
        const secret = await getEnterpriseSecret(
          ctx,
          enterprise._id,
          ENTERPRISE_OIDC_CLIENT_SECRET_KIND,
        );
        const oidcConfigured =
          oidc.enabled === true &&
          typeof oidc.clientId === "string" &&
          oidc.clientId.length > 0;

        checks.push({
          name: "oidc_configured",
          ok: oidcConfigured,
          message: oidcConfigured ? undefined : "OIDC is not configured.",
        });

        const hasClientId =
          typeof oidc.clientId === "string" && oidc.clientId.length > 0;
        checks.push({
          name: "client_id_present",
          ok: hasClientId,
          message: hasClientId ? undefined : "clientId is missing.",
        });

        checks.push({
          name: "client_secret_stored",
          ok: secret !== null,
          message:
            secret !== null ? undefined : "OIDC client secret is missing.",
        });

        const discoveryTarget = oidc.discoveryUrl ?? oidc.issuer;
        const hasDiscovery =
          typeof discoveryTarget === "string" && discoveryTarget.length > 0;
        checks.push({
          name: "issuer_or_discovery_url_present",
          ok: hasDiscovery,
          message: hasDiscovery
            ? undefined
            : "issuer or discoveryUrl is missing.",
        });

        let discoveryOk = false;
        let discoveryMessage: string | undefined;
        if (hasDiscovery) {
          const discoveryUrl = oidc.discoveryUrl?.length
            ? oidc.discoveryUrl
            : `${oidc.issuer}/.well-known/openid-configuration`;
          try {
            const res = await fetch(discoveryUrl, {
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(8_000),
            });
            if (!res.ok) {
              discoveryMessage = `Discovery endpoint returned ${res.status}.`;
            } else {
              const json = (await res.json()) as Record<string, unknown>;
              if (typeof json.issuer !== "string") {
                discoveryMessage =
                  "Discovery document is missing issuer field.";
              } else if (typeof json.authorization_endpoint !== "string") {
                discoveryMessage =
                  "Discovery document is missing authorization_endpoint.";
              } else {
                discoveryOk = true;
              }
            }
          } catch (e) {
            discoveryMessage =
              e instanceof Error
                ? `Discovery fetch failed: ${e.message}`
                : "Discovery fetch failed.";
          }
        } else {
          discoveryMessage = "Skipped — issuer or discoveryUrl not set.";
        }
        checks.push({
          name: "discovery_reachable",
          ok: discoveryOk,
          message: discoveryMessage,
        });

        return {
          ok: checks.every((c) => c.ok),
          enterpriseId: enterprise._id,
          checks,
        };
      },
    },
    scim: {
      configure: async (
        ctx: ComponentCtx,
        data: {
          enterpriseId: string;
          basePath?: string;
          status?: "draft" | "active" | "disabled";
        },
      ) => {
        const enterprise = await ctx.runQuery(
          config.component.public.enterpriseGet,
          {
            enterpriseId: data.enterpriseId,
          },
        );
        if (enterprise === null) {
          throw new AuthError(
            "INVALID_PARAMETERS",
            "Enterprise not found.",
          ).toConvexError();
        }
        const rawToken = generateRandomString(48, INVITE_TOKEN_ALPHABET);
        const tokenHash = await sha256(rawToken);
        const configId = (await ctx.runMutation(
          config.component.public.enterpriseScimConfigUpsert,
          {
            enterpriseId: enterprise._id,
            groupId: enterprise.groupId,
            status: data.status ?? "active",
            basePath:
              data.basePath ??
              `${requireEnv("CONVEX_SITE_URL")}/api/auth/sso/${enterprise._id}/scim/v2`,
            tokenHash,
            lastRotatedAt: Date.now(),
          },
        )) as string;
        const auditEventId = await recordEnterpriseAuditEvent(ctx, {
          enterpriseId: enterprise._id,
          groupId: enterprise.groupId,
          eventType: "enterprise.scim.configured",
          actorType: "system",
          subjectType: "enterprise_scim",
          subjectId: configId,
          ok: true,
        });
        await emitEnterpriseWebhookDeliveries(ctx, {
          enterpriseId: enterprise._id,
          eventType: "enterprise.scim.configured",
          auditEventId,
          payload: { enterpriseId: enterprise._id, scimConfigId: configId },
        });
        return { token: rawToken, configId };
      },
      get: async (ctx: ComponentReadCtx, enterpriseId: string) => {
        return await ctx.runQuery(
          config.component.public.enterpriseScimConfigGetByEnterprise,
          { enterpriseId },
        );
      },
      getConfigByToken: async (ctx: ComponentReadCtx, token: string) => {
        return await ctx.runQuery(
          config.component.public.enterpriseScimConfigGetByTokenHash,
          { tokenHash: await sha256(token) },
        );
      },
      /**
       * Validate the stored SCIM config for an enterprise connection.
       *
       * Checks that a SCIM config record exists, is active, has a token
       * hash set, and has a non-empty basePath. Returns a structured result
       * with per-check details.
       */
      validate: async (ctx: ComponentReadCtx, enterpriseId: string) => {
        const checks: Array<{
          name: string;
          ok: boolean;
          message?: string;
        }> = [];

        const enterprise = await ctx.runQuery(
          config.component.public.enterpriseGet,
          { enterpriseId },
        );

        if (!enterprise) {
          return {
            ok: false,
            enterpriseId,
            checks: [
              {
                name: "enterprise_exists",
                ok: false,
                message: "Enterprise not found.",
              },
            ],
          };
        }

        const policy = getPolicyFromEnterprise(enterprise);

        const scimConfig = await ctx.runQuery(
          config.component.public.enterpriseScimConfigGetByEnterprise,
          { enterpriseId },
        );

        const hasConfig = scimConfig !== null && scimConfig !== undefined;
        checks.push({
          name: "scim_config_exists",
          ok: hasConfig,
          message: hasConfig ? undefined : "SCIM has not been configured.",
        });

        const isActive = hasConfig && (scimConfig as any).status === "active";
        checks.push({
          name: "scim_config_active",
          ok: isActive,
          message: isActive
            ? undefined
            : `SCIM config status is ${hasConfig ? (scimConfig as any).status : "unknown"}.`,
        });

        const hasToken =
          hasConfig &&
          typeof (scimConfig as any).tokenHash === "string" &&
          (scimConfig as any).tokenHash.length > 0;
        checks.push({
          name: "token_hash_set",
          ok: hasToken,
          message: hasToken ? undefined : "SCIM bearer token has not been set.",
        });

        const hasBasePath =
          hasConfig &&
          typeof (scimConfig as any).basePath === "string" &&
          (scimConfig as any).basePath.length > 0;
        checks.push({
          name: "base_path_set",
          ok: hasBasePath,
          message: hasBasePath ? undefined : "SCIM basePath is missing.",
        });

        return {
          ok: checks.every((c) => c.ok),
          enterpriseId: enterprise._id,
          basePath: hasBasePath ? (scimConfig as any).basePath : null,
          deprovisionMode: policy.provisioning.deprovision.mode,
          checks,
        };
      },
      identity: {
        get: async (
          ctx: ComponentReadCtx,
          data: {
            enterpriseId: string;
            resourceType: "user" | "group";
            externalId: string;
          },
        ) => {
          return await ctx.runQuery(
            config.component.public.enterpriseScimIdentityGet,
            data,
          );
        },
        upsert: async (
          ctx: ComponentCtx,
          data: {
            enterpriseId: string;
            groupId: string;
            resourceType: "user" | "group";
            externalId: string;
            userId?: string;
            mappedGroupId?: string;
            active?: boolean;
            raw?: Record<string, unknown>;
          },
        ) => {
          return (await ctx.runMutation(
            config.component.public.enterpriseScimIdentityUpsert,
            { ...data, lastProvisionedAt: Date.now() },
          )) as string;
        },
      },
    },
    audit: {
      record: async (
        ctx: ComponentCtx,
        data: {
          enterpriseId: string;
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
      ) => {
        return await recordEnterpriseAuditEvent(ctx, data);
      },
      list: async (
        ctx: ComponentReadCtx,
        data: { enterpriseId?: string; groupId?: string; limit?: number },
      ) => {
        return await ctx.runQuery(
          config.component.public.enterpriseAuditEventList,
          data,
        );
      },
    },
    webhook: {
      endpoint: {
        create: async (
          ctx: ComponentCtx,
          data: {
            enterpriseId: string;
            url: string;
            secret: string;
            subscriptions: string[];
            createdByUserId?: string;
          },
        ) => {
          const enterprise = await ctx.runQuery(
            config.component.public.enterpriseGet,
            {
              enterpriseId: data.enterpriseId,
            },
          );
          if (enterprise === null) {
            throw new AuthError(
              "INVALID_PARAMETERS",
              "Enterprise not found.",
            ).toConvexError();
          }
          const secretHash = await sha256(data.secret);
          const endpointId = (await ctx.runMutation(
            config.component.public.enterpriseWebhookEndpointCreate,
            {
              enterpriseId: enterprise._id,
              groupId: enterprise.groupId,
              url: data.url,
              secretHash,
              subscriptions: data.subscriptions,
              createdByUserId: data.createdByUserId,
            },
          )) as string;
          await recordEnterpriseAuditEvent(ctx, {
            enterpriseId: enterprise._id,
            groupId: enterprise.groupId,
            eventType: "enterprise.webhook.endpoint.created",
            actorType: data.createdByUserId ? "user" : "system",
            actorId: data.createdByUserId,
            subjectType: "enterprise_webhook_endpoint",
            subjectId: endpointId,
            ok: true,
          });
          return { endpointId };
        },
        list: async (ctx: ComponentReadCtx, enterpriseId: string) => {
          return await ctx.runQuery(
            config.component.public.enterpriseWebhookEndpointList,
            { enterpriseId },
          );
        },
        disable: async (ctx: ComponentCtx, endpointId: string) => {
          await ctx.runMutation(
            config.component.public.enterpriseWebhookEndpointUpdate,
            { endpointId, data: { status: "disabled" } },
          );
        },
      },
      emit: async (
        ctx: ComponentCtx,
        data: {
          enterpriseId: string;
          eventType: string;
          payload: Record<string, unknown>;
          auditEventId?: string;
        },
      ) => {
        await emitEnterpriseWebhookDeliveries(ctx, data);
      },
      delivery: {
        list: async (
          ctx: ComponentReadCtx,
          data: { enterpriseId: string; limit?: number },
        ) => {
          return await ctx.runQuery(
            (config.component.public as any).enterpriseWebhookDeliveryList,
            data,
          );
        },
        listReady: async (ctx: ComponentReadCtx, limit?: number) => {
          return await ctx.runQuery(
            config.component.public.enterpriseWebhookDeliveryListReady,
            { now: Date.now(), limit },
          );
        },
        markDelivered: async (
          ctx: ComponentCtx,
          deliveryId: string,
          responseStatus?: number,
        ) => {
          await ctx.runMutation(
            config.component.public.enterpriseWebhookDeliveryPatch,
            {
              deliveryId,
              data: {
                status: "delivered",
                attemptCount: 1,
                lastAttemptAt: Date.now(),
                lastResponseStatus: responseStatus,
              },
            },
          );
        },
        markFailed: async (
          ctx: ComponentCtx,
          deliveryId: string,
          data: {
            attemptCount: number;
            responseStatus?: number;
            error?: string;
            retryAt?: number;
          },
        ) => {
          await ctx.runMutation(
            config.component.public.enterpriseWebhookDeliveryPatch,
            {
              deliveryId,
              data: {
                status: data.retryAt ? "pending" : "failed",
                attemptCount: data.attemptCount,
                lastAttemptAt: Date.now(),
                lastResponseStatus: data.responseStatus,
                lastError: data.error,
                nextAttemptAt: data.retryAt ?? Date.now(),
              },
            },
          );
        },
      },
    },
  };
}
