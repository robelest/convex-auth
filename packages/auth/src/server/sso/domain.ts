import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import { GenericActionCtx, GenericDataModel } from "convex/server";

import type { GroupConnectionPolicyPatch } from "../types";

type ComponentCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
type ComponentReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;

/**
 * Build the connection and SSO management domain.
 */
export function createGroupConnectionDomain(deps: any) {
  const {
    config,
    normalizeGroupConnectionPolicy,
    normalizeDomain,
    getGroupConnectionSecret,
    loadConnectionOrThrow,
    validateGroupConnectionPolicy,
    recordGroupAuditEvent,
    emitGroupWebhookDeliveries,
    connectionNotFoundError,
    GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND,
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
    getSamlConfig,
    getGroupOidcUrls,
    getGroupSamlUrls,
    groupOidcProviderId,
    groupSamlProviderId,
    loadGroupPolicyOrThrow,
    patchGroupConnectionPolicy,
  } = deps;

  const resolveGroupConnectionProtocol = (connection: {
    _id: string;
    protocol?: unknown;
    config?: unknown;
  }): "oidc" | "saml" => {
    if (connection.protocol === "oidc") {
      return "oidc";
    }
    if (connection.protocol === "saml") {
      return "saml";
    }
    throw Cv.error({
      code: "PROVIDER_NOT_CONFIGURED",
      message: "Group connection protocol is not configured.",
    });
  };

  const GROUP_CONNECTION_DOMAIN_VERIFICATION_PREFIX =
    "_convex-auth-verification";
  const GROUP_CONNECTION_DOMAIN_VERIFICATION_TTL_MS =
    1000 * 60 * 60 * 24 * 7;

  const toDomainSummary = (domain: {
    _id: string;
    domain: string;
    isPrimary: boolean;
    verifiedAt?: number;
  }) => ({
    domainId: domain._id,
    domain: domain.domain,
    isPrimary: domain.isPrimary,
    verified: domain.verifiedAt !== undefined,
    verifiedAt: domain.verifiedAt ?? null,
  });

  const getDomainVerificationRecordName = (domain: string) =>
    `${GROUP_CONNECTION_DOMAIN_VERIFICATION_PREFIX}.${normalizeDomain(domain)}`;

  const parseTxtAnswer = (value: string) => {
    const quoted = [...value.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    if (quoted.length > 0) {
      return quoted.join("");
    }
    return value.replace(/^"|"$/g, "").trim();
  };

  const resolveTxtValues = async (recordName: string) => {
    const url = new URL("https://dns.google/resolve");
    url.searchParams.set("name", recordName);
    url.searchParams.set("type", "TXT");

    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`DNS TXT lookup failed with status ${response.status}.`);
    }
    const data = (await response.json()) as {
      Answer?: Array<{ data?: string }>;
    };
    return (data.Answer ?? [])
      .map((answer) =>
        typeof answer.data === "string" ? parseTxtAnswer(answer.data) : null,
      )
      .filter((value): value is string => value !== null && value.length > 0);
  };

  return {
    connection: {
      create: async (
        ctx: ComponentCtx,
        data: {
          groupId: string;
          protocol: "oidc" | "saml";
          slug?: string;
          name?: string;
          status?: "draft" | "active" | "disabled";
          config?: Record<string, unknown>;
          extend?: Record<string, unknown>;
        },
      ): Promise<{ connectionId: string; groupId: string }> => {
        const connectionId = (await ctx.runMutation(
          config.component.public.groupConnectionCreate,
          data,
        )) as string;
        return {
          connectionId,
          groupId: data.groupId,
        };
      },
      get: async (ctx: ComponentReadCtx, connectionId: string) => {
        return await ctx.runQuery(config.component.public.groupConnectionGet, {
          connectionId,
        });
      },
      getByDomain: async (ctx: ComponentReadCtx, domain: string) => {
        return await ctx.runQuery(
          config.component.public.groupConnectionGetByDomain,
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
        return await ctx.runQuery(config.component.public.groupConnectionList, {
          where: opts?.where,
          limit: opts?.limit,
          cursor: opts?.cursor,
          orderBy: opts?.orderBy,
          order: opts?.order,
        });
      },
      update: async (
        ctx: ComponentCtx,
        connectionId: string,
        data: Record<string, unknown>,
      ) => {
        await ctx.runMutation(config.component.public.groupConnectionUpdate, {
          connectionId,
          data,
        });
        return { connectionId };
      },
      delete: async (ctx: ComponentCtx, connectionId: string) => {
        await ctx.runMutation(config.component.public.groupConnectionDelete, {
          connectionId,
        });
        return { connectionId };
      },
      /**
       * Aggregate readiness status across all configured protocols for an
       * group connection.
       *
       * Returns a structured result indicating whether the connection is
       * ready, with per-protocol checks so callers can surface actionable
       * diagnostics without running full network validation.
       */
      status: async (ctx: ComponentReadCtx, connectionId: string) => {
        const connection = await ctx.runQuery(
          config.component.public.groupConnectionGet,
          { connectionId },
        );
        if (!connection) {
          throw Cv.error({
            code: "INVALID_PARAMETERS",
            message: connectionNotFoundError,
          });
        }
        const policy = await loadGroupPolicyOrThrow(ctx, connection.groupId);
        const oidcConfig = getOidcConfig(connection.config);
        const oidcSecret = await getGroupConnectionSecret(
          ctx,
          connection._id,
          GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND,
        );
        const samlConfig = getSamlConfig(connection.config);
        const scimConfig = await ctx.runQuery(
          config.component.public.groupConnectionScimConfigGetByGroupConnection,
          { connectionId },
        );
        const domains = await ctx.runQuery(
          config.component.public.groupConnectionDomainList,
          { connectionId },
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
          connection.status === "active" &&
          (connection.protocol === "oidc" ? oidcReady : samlReady);

        return {
          connectionId: connection._id,
          status: connection.status,
          ready,
          domainCount: (domains as unknown[]).length,
          protocols: {
            oidc: {
              configured: connection.protocol === "oidc" ? oidcReady : false,
              ready: connection.protocol === "oidc" ? oidcReady : false,
              clientId: oidcConfig?.clientId ?? null,
              issuer: oidcConfig?.issuer ?? oidcConfig?.discoveryUrl ?? null,
            },
            saml: {
              configured: connection.protocol === "saml" ? samlReady : false,
              ready: connection.protocol === "saml" ? samlReady : false,
              entityId:
                samlConfig?.idp?.entityId ?? samlConfig?.idp?.issuer ?? null,
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
          connectionId: string;
          groupId: string;
          domain: string;
          isPrimary?: boolean;
        },
      ): Promise<string> => {
        return (await ctx.runMutation(
          config.component.public.groupConnectionDomainAdd,
          {
            ...data,
            domain: normalizeDomain(data.domain),
          },
        )) as string;
      },
      list: async (ctx: ComponentReadCtx, connectionId: string) => {
        return await ctx.runQuery(
          config.component.public.groupConnectionDomainList,
          {
            connectionId,
          },
        );
      },
      validate: async (ctx: ComponentReadCtx, connectionId: string) => {
        const connection = await ctx.runQuery(
          config.component.public.groupConnectionGet,
          { connectionId },
        );
        if (connection === null) {
          throw Cv.error({
            code: "INVALID_PARAMETERS",
            message: connectionNotFoundError,
          });
        }

        const domains = await ctx.runQuery(
          config.component.public.groupConnectionDomainList,
          { connectionId },
        );
        const primaryDomains = domains.filter(
          (domain: (typeof domains)[number]) => domain.isPrimary,
        );
        const verifiedDomains = domains.filter(
          (domain: (typeof domains)[number]) => domain.verifiedAt !== undefined,
        );

        const warnings: string[] = [];
        if (domains.length === 0) {
          warnings.push("No domains configured.");
        }
        if (primaryDomains.length === 0 && domains.length > 0) {
          warnings.push("No primary domain configured.");
        }
        if (primaryDomains.length > 1) {
          warnings.push("Multiple primary domains configured.");
        }
        if (verifiedDomains.length === 0 && domains.length > 0) {
          warnings.push("No verified domains yet.");
        }

        return {
          connectionId,
          ready:
            connection.status === "active" &&
            domains.length > 0 &&
            primaryDomains.length === 1 &&
            verifiedDomains.length > 0,
          summary: {
            domainCount: domains.length,
            primaryCount: primaryDomains.length,
            verifiedCount: verifiedDomains.length,
          },
          domains: domains.map((domain: (typeof domains)[number]) =>
            toDomainSummary(domain),
          ),
          warnings,
        };
      },
      remove: async (ctx: ComponentCtx, domainId: string) => {
        await ctx.runMutation(config.component.public.groupConnectionDomainDelete, {
          domainId,
        });
      },
      verification: {
        request: async (
          ctx: ComponentCtx,
          args: { connectionId: string; domain: string },
        ) => {
          const connection = await loadConnectionOrThrow(
            ctx,
            args.connectionId,
          );
          const normalizedDomain = normalizeDomain(args.domain);
          const domains = await ctx.runQuery(
            config.component.public.groupConnectionDomainList,
            { connectionId: connection._id },
          );
          const domain = domains.find(
            (entry: (typeof domains)[number]) =>
              entry.domain === normalizedDomain,
          );
          if (!domain) {
            throw Cv.error({
              code: "INVALID_PARAMETERS",
              message: "Domain is not attached to this connection.",
            });
          }

          const requestedAt = Date.now();
          const expiresAt =
            requestedAt + GROUP_CONNECTION_DOMAIN_VERIFICATION_TTL_MS;
          const token = generateRandomString(32, INVITE_TOKEN_ALPHABET);
          const tokenHash = await sha256(token);
          const recordName = getDomainVerificationRecordName(normalizedDomain);

          await ctx.runMutation(
            config.component.public.groupConnectionDomainVerificationUpsert,
            {
              connectionId: connection._id,
              groupId: connection.groupId,
              domainId: domain._id,
              domain: normalizedDomain,
              recordName,
              token,
              tokenHash,
              requestedAt,
              expiresAt,
            },
          );

          await recordGroupAuditEvent(ctx, {
            connectionId: connection._id,
            groupId: connection.groupId,
            eventType: "group.sso.domain.verification_requested",
            actorType: "system",
            subjectType: "group_connection_domain",
            subjectId: domain._id,
            ok: true,
            metadata: { domain: normalizedDomain, recordName, expiresAt },
          });

          return {
            connectionId: connection._id,
            domain: normalizedDomain,
            requestedAt,
            expiresAt,
            challenge: {
              recordType: "TXT" as const,
              recordName,
              recordValue: token,
            },
          };
        },
        confirm: async (
          ctx: ComponentCtx,
          args: { connectionId: string; domain: string },
        ) => {
          const connection = await loadConnectionOrThrow(
            ctx,
            args.connectionId,
          );
          const normalizedDomain = normalizeDomain(args.domain);
          const domains = await ctx.runQuery(
            config.component.public.groupConnectionDomainList,
            { connectionId: connection._id },
          );
          const domain = domains.find(
            (entry: (typeof domains)[number]) =>
              entry.domain === normalizedDomain,
          );
          if (!domain) {
            throw Cv.error({
              code: "INVALID_PARAMETERS",
              message: "Domain is not attached to this connection.",
            });
          }

          if (domain.verifiedAt !== undefined) {
            return {
              ok: true,
              connectionId: connection._id,
              domain: normalizedDomain,
              verifiedAt: domain.verifiedAt,
              checks: [
                {
                  name: "domain_verified",
                  ok: true,
                  message: "Domain is already verified.",
                },
              ],
            };
          }

          const verification = await ctx.runQuery(
            config.component.public.groupConnectionDomainVerificationGet,
            { domainId: domain._id },
          );
          const checks: Array<{ name: string; ok: boolean; message?: string }> =
            [];
          if (!verification) {
            checks.push({
              name: "verification_requested",
              ok: false,
              message: "No active domain verification challenge exists.",
            });
            return {
              ok: false,
              connectionId: connection._id,
              domain: normalizedDomain,
              checks,
            };
          }

          checks.push({ name: "verification_requested", ok: true });

          if (verification.expiresAt < Date.now()) {
            await ctx.runMutation(
              config.component.public.groupConnectionDomainVerificationDelete,
              { domainId: domain._id },
            );
            checks.push({
              name: "challenge_active",
              ok: false,
              message: "The verification challenge expired. Request a new one.",
            });
            return {
              ok: false,
              connectionId: connection._id,
              domain: normalizedDomain,
              checks,
            };
          }

          checks.push({ name: "challenge_active", ok: true });

          let txtValues: string[];
          try {
            txtValues = await resolveTxtValues(verification.recordName);
          } catch (error) {
            throw Cv.error({
              code: "INTERNAL_ERROR",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to resolve DNS TXT records.",
            });
          }

          checks.push({
            name: "dns_record_present",
            ok: txtValues.length > 0,
            message:
              txtValues.length > 0
                ? undefined
                : `No TXT records found at ${verification.recordName}.`,
          });

          const matches = txtValues.includes(verification.token);
          checks.push({
            name: "dns_record_matches",
            ok: matches,
            message: matches
              ? undefined
              : `TXT record at ${verification.recordName} does not match the expected value.`,
          });

          if (!checks.every((check) => check.ok)) {
            return {
              ok: false,
              connectionId: connection._id,
              domain: normalizedDomain,
              checks,
            };
          }

          const verifiedAt = Date.now();
          await ctx.runMutation(
            config.component.public.groupConnectionDomainVerify,
            {
              domainId: domain._id,
              verifiedAt,
            },
          );

          await recordGroupAuditEvent(ctx, {
            connectionId: connection._id,
            groupId: connection.groupId,
            eventType: "group.sso.domain.verified",
            actorType: "system",
            subjectType: "group_connection_domain",
            subjectId: domain._id,
            ok: true,
            metadata: { domain: normalizedDomain, verifiedAt },
          });

          return {
            ok: true,
            connectionId: connection._id,
            domain: normalizedDomain,
            verifiedAt,
            checks,
          };
        },
      },
    },
    saml: {
      configure: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        data: {
          connectionId: string;
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
            const connection = yield* Fx.from({
              ok: () =>
                ctx.runQuery(config.component.public.groupConnectionGet, {
                  connectionId: data.connectionId,
                }),
              err: () =>
                Cv.error({
                  code: "INTERNAL_ERROR",
                  message: "Failed to load connection.",
                }),
            }).pipe(
              Fx.chain((ent) =>
                ent === null
                  ? Cv.fail({
                      code: "INVALID_PARAMETERS",
                      message: connectionNotFoundError,
                    })
                  : Fx.succeed(ent),
              ),
            );
            yield* Fx.guard(
              connection.protocol !== "saml",
              Cv.fail({
                code: "INVALID_PARAMETERS",
                message: "This connection is not a SAML connection.",
              }),
            );
            const metadataUrl =
              typeof data.metadataUrl === "string" && data.metadataUrl.length > 0
                ? data.metadataUrl
                : undefined;
            const metadataXml = yield* (metadataUrl
              ? Fx.defer(() =>
                  Fx.from({
                    ok: async () => {
                      const response = await fetch(metadataUrl);
                      if (!response.ok) {
                        throw new Error(
                          `Failed to fetch SAML metadata: ${response.status}`,
                        );
                      }
                      return await response.text();
                    },
                    err: (error) =>
                      Cv.error({
                        code: "INVALID_PARAMETERS",
                        message:
                          error instanceof Error
                            ? error.message
                            : "Failed to fetch SAML metadata",
                      }),
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
                    Cv.fail({
                      code: "INVALID_PARAMETERS",
                      message:
                        error instanceof Error
                          ? error.message
                          : "Failed to fetch SAML metadata",
                    }),
                  ),
                )
              : data.metadataXml
                ? Fx.succeed(data.metadataXml)
                : Cv.fail({
                    code: "INVALID_PARAMETERS",
                    message:
                      "SAML registration requires metadataXml or metadataUrl.",
                  }));

            const parsed = yield* Fx.from({
              ok: () => parseSamlIdpMetadata(metadataXml),
              err: (error) =>
                Cv.error({
                  code: "INVALID_PARAMETERS",
                  message:
                    error instanceof Error
                      ? `Failed to parse SAML metadata: ${error.message}`
                      : "Failed to parse SAML metadata.",
                }),
            });
            console.log("[group-sso] saml:configure:parsed", {
              connectionId: data.connectionId,
              metadataUrl,
              entityId: parsed.entityId,
              issuer: parsed.issuer,
            });

            const baseConfig = upsertProtocolConfig(connection.config, "saml", {
              enabled: true,
              idp: {
                metadataUrl,
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
            console.log("[group-sso] saml:configure:nextConfig", {
              connectionId: data.connectionId,
              entityId: nextConfig?.protocols?.saml?.idp?.entityId ?? null,
              issuer: nextConfig?.protocols?.saml?.idp?.issuer ?? null,
              metadataUrl: nextConfig?.protocols?.saml?.idp?.metadataUrl ?? null,
              hasMetadataXml:
                typeof nextConfig?.protocols?.saml?.idp?.metadataXml ===
                "string",
            });

            yield* Fx.from({
              ok: () =>
                ctx.runMutation(config.component.public.groupConnectionUpdate, {
                  connectionId: connection._id,
                  data: {
                    status: "active",
                    config: nextConfig,
                  },
                }),
              err: () =>
                Cv.error({
                  code: "INTERNAL_ERROR",
                  message: "Failed to persist SAML registration.",
                }),
            });

            if (normalizedDomains) {
              for (const [index, domain] of normalizedDomains.entries()) {
                yield* Fx.from({
                  ok: () =>
                    ctx.runMutation(
                      config.component.public.groupConnectionDomainAdd,
                      {
                        connectionId: connection._id,
                        groupId: connection.groupId,
                        domain,
                        isPrimary: index === 0,
                      },
                    ),
                  err: () =>
                    Cv.error({
                      code: "INTERNAL_ERROR",
                      message: "Failed to persist connection domain.",
                    }),
                });
              }
            }

            yield* Fx.from({
              ok: () =>
                recordGroupAuditEvent(ctx, {
                  connectionId: connection._id,
                  groupId: connection.groupId,
                  eventType: "group.sso.saml.registered",
                  actorType: "system",
                  subjectType: "group_connection_saml",
                  subjectId: connection._id,
                  ok: true,
                  metadata: {
                    metadataUrl: data.metadataUrl,
                    domains: normalizedDomains,
                  },
                }),
              err: () =>
                Cv.error({
                  code: "INTERNAL_ERROR",
                  message: "Failed to record SAML registration audit event.",
                }),
            });

            return {
              connectionId: connection._id,
              groupId: connection.groupId,
            };
          }).pipe(Fx.recover((e) => Fx.fatal(e))),
        );
      },
      metadata: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        opts: {
          connectionId: string;
          entityId?: string;
          acsUrl?: string;
          sloUrl?: string;
        },
      ) => {
        const connection = await ctx.runQuery(
          config.component.public.groupConnectionGet,
          {
            connectionId: opts.connectionId,
          },
        );
        if (!connection) {
          throw Cv.error({
            code: "INVALID_PARAMETERS",
            message: "Connection not found.",
          });
        }

        return createServiceProviderMetadata(
          getSamlServiceProviderOptions({
            rootUrl: requireEnv("CONVEX_SITE_URL"),
            source: { kind: "connection", id: connection._id },
            config: connection.config,
            overrides: {
              entityId: opts.entityId,
              acsUrl: opts.acsUrl,
              sloUrl: opts.sloUrl,
            },
          }),
        );
      },
      /**
       * Validate the stored SAML config for an group connection.
       *
       * Re-parses IdP metadata, checks signing cert presence, and verifies
       * SP metadata can be generated. Returns a structured result with
       * per-check details rather than throwing on first failure.
       */
      validate: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        connectionId: string,
      ) => {
        const checks: Array<{
          name: string;
          ok: boolean;
          message?: string;
        }> = [];

        const connection = await ctx.runQuery(
          config.component.public.groupConnectionGet,
          { connectionId },
        );

        if (!connection) {
          return {
            ok: false,
            connectionId,
            checks: [
              {
                name: "group_connection_exists",
                ok: false,
                message: "Connection not found.",
              },
            ],
          };
        }

        const samlConfig = connection.config?.protocols?.saml;
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

        const reparsedIdp =
          hasIdpMetadata && typeof samlConfig?.idp?.metadataXml === "string"
            ? (() => {
                try {
                  return parseSamlIdpMetadata(samlConfig.idp.metadataXml);
                } catch {
                  return null;
                }
              })()
            : null;
        console.log("[group-sso] saml:validate:idp", {
          connectionId,
          entityId: samlConfig?.idp?.entityId ?? null,
          issuer: samlConfig?.idp?.issuer ?? null,
          metadataUrl: samlConfig?.idp?.metadataUrl ?? null,
          reparsedEntityId: reparsedIdp?.entityId ?? null,
          reparsedIssuer: reparsedIdp?.issuer ?? null,
        });
        const hasEntityId =
          (typeof samlConfig?.idp?.entityId === "string" &&
            samlConfig.idp.entityId.length > 0) ||
          (typeof samlConfig?.idp?.issuer === "string" &&
            samlConfig.idp.issuer.length > 0) ||
          (typeof reparsedIdp?.entityId === "string" &&
            reparsedIdp.entityId.length > 0) ||
          (typeof reparsedIdp?.issuer === "string" &&
            reparsedIdp.issuer.length > 0);
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
                source: { kind: "connection", id: connection._id },
                config: connection.config,
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
          connectionId: connection._id,
          checks,
        };
      },
    },
      policy: {
        get: async (ctx: ComponentReadCtx, groupId: string) => {
          return await loadGroupPolicyOrThrow(ctx, groupId);
        },
      update: async (
        ctx: ComponentCtx,
        groupId: string,
        patch: GroupConnectionPolicyPatch,
      ) => {
        const group = await ctx.runQuery(config.component.public.groupGet, {
          groupId,
        });
        if (!group) {
          throw Cv.error({
            code: "INVALID_PARAMETERS",
            message: "Group not found.",
          });
        }
        const policy = patchGroupConnectionPolicy(group.policy, patch);
        await ctx.runMutation(config.component.public.groupUpdate, {
          groupId,
          data: { policy },
        });
        await recordGroupAuditEvent(ctx, {
          groupId,
          eventType: "group.sso.policy.updated",
          actorType: "system",
          subjectType: "group_policy",
          subjectId: groupId,
          ok: true,
          metadata: { version: policy.version },
        });
        return policy;
      },
      validate: async (ctx: ComponentReadCtx, groupId: string) => {
        const group = await ctx.runQuery(
          config.component.public.groupGet,
          { groupId },
        );
        if (!group) {
          return {
            ok: false,
            groupId,
            checks: [
              {
                name: "group_exists",
                ok: false,
                message: "Group not found.",
              },
            ],
          };
        }
        const policy = await loadGroupPolicyOrThrow(ctx, groupId);
        const checks = validateGroupConnectionPolicy(policy);
        return {
          ok: checks.every((check: { ok: boolean }) => check.ok),
          groupId,
          policy,
          checks,
        };
      },
    },
    oidc: {
      /**
       * Register or update connection OIDC connection settings.
       *
       * Persists protocol config under `connection.config.protocols.oidc` and
        * records a `group.sso.oidc.registered` audit event.
       */
      configure: async (
        ctx: ComponentCtx,
        data: {
          connectionId: string;
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
              Cv.fail({
                code: "INVALID_PARAMETERS",
                message: "OIDC registration requires issuer or discoveryUrl.",
              }),
            );

            const connection = yield* Fx.from({
              ok: () =>
                ctx.runQuery(config.component.public.groupConnectionGet, {
                  connectionId: data.connectionId,
                }),
              err: () =>
                Cv.error({
                  code: "INTERNAL_ERROR",
                  message: "Failed to load connection.",
                }),
            }).pipe(
              Fx.chain((ent) =>
                ent === null
                  ? Cv.fail({
                      code: "INVALID_PARAMETERS",
                      message: connectionNotFoundError,
                    })
                  : Fx.succeed(ent),
              ),
            );
            yield* Fx.guard(
              connection.protocol !== "oidc",
              Cv.fail({
                code: "INVALID_PARAMETERS",
                message: "This connection is not an OIDC connection.",
              }),
            );
            const nextConfig = upsertProtocolConfig(connection.config, "oidc", {
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
                ctx.runMutation(config.component.public.groupConnectionUpdate, {
                  connectionId: data.connectionId,
                  data: { config: nextConfig },
                }),
              err: () =>
                Cv.error({
                  code: "INTERNAL_ERROR",
                  message: "Failed to persist OIDC registration.",
                }),
            });

            if (data.clientSecret !== undefined) {
              const ciphertext = yield* Fx.from({
                ok: () => encryptSecret(data.clientSecret!),
                err: () =>
                  Cv.error({
                    code: "INTERNAL_ERROR",
                    message: "Failed to encrypt OIDC client secret.",
                  }),
              });
              yield* Fx.from({
                ok: () =>
                  ctx.runMutation(
                    config.component.public.groupConnectionSecretUpsert,
                    {
                      connectionId: data.connectionId,
                      groupId: connection.groupId,
                      kind: GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND,
                      ciphertext,
                      updatedAt: Date.now(),
                    },
                  ),
                err: () =>
                  Cv.error({
                    code: "INTERNAL_ERROR",
                    message: "Failed to persist OIDC client secret.",
                  }),
              });
            }

            yield* Fx.from({
              ok: () =>
                recordGroupAuditEvent(ctx, {
                  connectionId: data.connectionId,
                  groupId: connection.groupId,
                  eventType: "group.sso.oidc.registered",
                  actorType: "system",
                  subjectType: "group_connection_oidc",
                  subjectId: data.connectionId,
                  ok: true,
                  metadata: {
                    issuer: data.issuer,
                    discoveryUrl: data.discoveryUrl,
                  },
                }),
              err: () =>
                Cv.error({
                  code: "INTERNAL_ERROR",
                  message: "Failed to record OIDC registration audit event.",
                }),
            });

            const secret = yield* Fx.from({
              ok: () =>
                getGroupConnectionSecret(
                  ctx,
                  data.connectionId,
                  GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND,
                ),
              err: () =>
                Cv.error({
                  code: "INTERNAL_ERROR",
                  message: "Failed to load OIDC secret metadata.",
                }),
            });

            return withOidcSecretState(
              getPublicOidcConfig(nextConfig),
              secret !== null,
            );
          }).pipe(Fx.recover((e) => Fx.fatal(e))),
        );
      },
      /**
       * Fetch the stored OIDC config for an connection.
       */
      get: async (ctx: ComponentReadCtx, connectionId: string) => {
        return await Fx.run(
          Fx.from({
            ok: () =>
              ctx.runQuery(config.component.public.groupConnectionGet, {
                connectionId,
              }),
            err: () =>
              Cv.error({
                code: "INTERNAL_ERROR",
                message: "Failed to load connection.",
              }),
          }).pipe(
            Fx.chain((ent) =>
              ent === null
                ? Cv.fail({
                    code: "INVALID_PARAMETERS",
                    message: connectionNotFoundError,
                  })
                : Fx.succeed(ent),
            ),
            Fx.chain((connection) =>
              Fx.from({
                ok: async () => {
                  const secret = await getGroupConnectionSecret(
                    ctx,
                    connection._id,
                    GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND,
                  );
                  return withOidcSecretState(
                    getPublicOidcConfig(connection.config),
                    secret !== null,
                  );
                },
                err: () =>
                  Cv.error({
                    code: "INTERNAL_ERROR",
                    message: "Failed to load OIDC secret metadata.",
                  }),
              }),
            ),
            Fx.recover((e) => Fx.fatal(e)),
          ),
        );
      },
      /**
       * Resolve group SSO sign-in route from connection id, domain, or
       * user email domain.
       */
      signIn: async (
        ctx: ComponentReadCtx,
        data: {
          connectionId?: string;
          email?: string;
          domain?: string;
          redirectTo?: string;
        },
      ) => {
        console.log("[group-sso] resolver:start", {
          connectionId: data.connectionId,
          email: data.email,
          domain: data.domain,
          redirectTo: data.redirectTo,
        });
        return await Fx.run(
          Fx.gen(function* () {
            const connection =
              data.connectionId !== undefined
                ? yield* Fx.from({
                    ok: () =>
                      ctx.runQuery(config.component.public.groupConnectionGet, {
                        connectionId: data.connectionId,
                      }),
                    err: () =>
                      Cv.error({
                        code: "INTERNAL_ERROR",
                        message: "Failed to load connection.",
                      }),
                  }).pipe(
                    Fx.chain((ent) =>
                      ent === null
                        ? Cv.fail({
                            code: "INVALID_PARAMETERS",
                            message: connectionNotFoundError,
                          })
                        : Fx.succeed(ent),
                    ),
                  )
                : data.domain !== undefined || data.email !== undefined
                  ? yield* Fx.from({
                      ok: () =>
                        ctx.runQuery(
                          config.component.public.groupConnectionGetByDomain,
                          {
                            domain: normalizeDomain(
                              data.domain ??
                                String(data.email).split("@").pop() ??
                                "",
                            ),
                          },
                        ),
                      err: () =>
                        Cv.error({
                          code: "INTERNAL_ERROR",
                          message: "Failed to resolve connection by domain.",
                        }),
                    }).pipe(
                      Fx.tap((result) =>
                        Fx.sync(() => {
                          console.log("[group-sso] resolver:domainLookup", result);
                        }),
                      ),
                      Fx.chain((result) =>
                        result?.connection &&
                        result.domain?.verifiedAt !== undefined
                          ? Fx.succeed(result.connection)
                          : Cv.fail({
                              code: "INVALID_PARAMETERS",
                              message:
                                "No group connection matched the provided input.",
                            }),
                      ),
                    )
                  : yield* Cv.fail({
                      code: "INVALID_PARAMETERS",
                      message:
                        "No group connection matched the provided input.",
                    });

            yield* Fx.guard(
              connection.status !== "active",
              Cv.fail({
                code: "INVALID_PARAMETERS",
                message: "Group connection is not active.",
              }),
            );

            const protocol = resolveGroupConnectionProtocol(connection);
            console.log("[group-sso] resolver:connection", {
              connectionId: connection._id,
              status: connection.status,
              protocol,
            });
            const urls =
              protocol === "oidc"
                ? getGroupOidcUrls({
                    rootUrl: requireEnv("CONVEX_SITE_URL"),
                    connectionId: connection._id,
                  })
                : getGroupSamlUrls({
                    rootUrl: requireEnv("CONVEX_SITE_URL"),
                    source: { kind: "connection", id: connection._id },
                  });
            const signInPath =
              protocol === "oidc"
                ? urls.signInUrl
                : `${requireEnv("CONVEX_SITE_URL")}/api/auth/connections/${connection._id}/saml/signin`;
            const callbackPath =
              protocol === "oidc" ? urls.callbackUrl : urls.acsUrl;
            console.log("[group-sso] resolver:paths", {
              connectionId: connection._id,
              signInPath,
              callbackPath,
            });
            return {
              connectionId: connection._id,
              protocol,
              providerId:
                protocol === "oidc"
                  ? groupOidcProviderId(connection._id)
                  : groupSamlProviderId(connection._id),
              signInPath,
              callbackPath,
              redirectTo: data.redirectTo,
            };
          }).pipe(Fx.recover((e) => Fx.fatal(e))),
        );
      },
      /**
       * Validate the stored OIDC config for an group connection.
       *
       * Fetches the OIDC discovery document from the configured issuer or
       * discoveryUrl, verifies required fields are present, and checks that
       * clientId is set. Returns a structured result with per-check details.
       */
      validate: async (ctx: ComponentReadCtx, connectionId: string) => {
        const checks: Array<{
          name: string;
          ok: boolean;
          message?: string;
        }> = [];

        const connection = await ctx.runQuery(
          config.component.public.groupConnectionGet,
          { connectionId },
        );

        if (!connection) {
          return {
            ok: false,
            connectionId,
            checks: [
              {
                name: "group_connection_exists",
                ok: false,
                message: "Connection not found.",
              },
            ],
          };
        }

        const oidc = getOidcConfig(connection.config);
        const secret = await getGroupConnectionSecret(
          ctx,
          connection._id,
          GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND,
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
          connectionId: connection._id,
          checks,
        };
      },
    },
    scim: {
      configure: async (
        ctx: ComponentCtx,
        data: {
          connectionId: string;
          basePath?: string;
          status?: "draft" | "active" | "disabled";
        },
      ) => {
        const connection = await ctx.runQuery(
          config.component.public.groupConnectionGet,
          {
            connectionId: data.connectionId,
          },
        );
        if (connection === null) {
          throw Cv.error({
            code: "INVALID_PARAMETERS",
            message: "Connection not found.",
          });
        }
        const rawToken = generateRandomString(48, INVITE_TOKEN_ALPHABET);
        const tokenHash = await sha256(rawToken);
        const configId = (await ctx.runMutation(
          config.component.public.groupConnectionScimConfigUpsert,
          {
            connectionId: connection._id,
            groupId: connection.groupId,
            status: data.status ?? "active",
            basePath:
              data.basePath ??
              `${requireEnv("CONVEX_SITE_URL")}/api/auth/connections/${connection._id}/scim/v2`,
            tokenHash,
            lastRotatedAt: Date.now(),
          },
        )) as string;
        const auditEventId = await recordGroupAuditEvent(ctx, {
          connectionId: connection._id,
          groupId: connection.groupId,
          eventType: "group.sso.scim.configured",
          actorType: "system",
          subjectType: "group_connection_scim",
          subjectId: configId,
          ok: true,
        });
        await emitGroupWebhookDeliveries(ctx, {
          connectionId: connection._id,
          eventType: "group.sso.scim.configured",
          auditEventId,
          payload: { connectionId: connection._id, scimConfigId: configId },
        });
        return {
          connectionId: connection._id,
          configId,
          basePath:
            data.basePath ??
            `${requireEnv("CONVEX_SITE_URL")}/api/auth/connections/${connection._id}/scim/v2`,
          token: rawToken,
        };
      },
      get: async (ctx: ComponentReadCtx, connectionId: string) => {
        return await ctx.runQuery(
          config.component.public.groupConnectionScimConfigGetByGroupConnection,
          { connectionId },
        );
      },
      getConfigByToken: async (ctx: ComponentReadCtx, token: string) => {
        return await ctx.runQuery(
          config.component.public.groupConnectionScimConfigGetByTokenHash,
          { tokenHash: await sha256(token) },
        );
      },
      /**
       * Validate the stored SCIM config for an group connection.
       *
       * Checks that a SCIM config record exists, is active, has a token
       * hash set, and has a non-empty basePath. Returns a structured result
       * with per-check details.
       */
      validate: async (ctx: ComponentReadCtx, connectionId: string) => {
        const checks: Array<{
          name: string;
          ok: boolean;
          message?: string;
        }> = [];

        const connection = await ctx.runQuery(
          config.component.public.groupConnectionGet,
          { connectionId },
        );

        if (!connection) {
          return {
            ok: false,
            connectionId,
            checks: [
              {
                name: "group_connection_exists",
                ok: false,
                message: "Connection not found.",
              },
            ],
          };
        }

        const policy = await loadGroupPolicyOrThrow(ctx, connection.groupId);

        const scimConfig = await ctx.runQuery(
          config.component.public.groupConnectionScimConfigGetByGroupConnection,
          { connectionId },
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
          connectionId: connection._id,
          basePath: hasBasePath ? (scimConfig as any).basePath : null,
          deprovisionMode: policy.provisioning.deprovision.mode,
          checks,
        };
      },
      identity: {
        get: async (
          ctx: ComponentReadCtx,
          data: {
            connectionId: string;
            resourceType: "user" | "group";
            externalId: string;
          },
        ) => {
          return await ctx.runQuery(
            config.component.public.groupConnectionScimIdentityGet,
            data,
          );
        },
        upsert: async (
          ctx: ComponentCtx,
          data: {
            connectionId: string;
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
            config.component.public.groupConnectionScimIdentityUpsert,
            { ...data, lastProvisionedAt: Date.now() },
          )) as string;
        },
      },
    },
    audit: {
      record: async (
        ctx: ComponentCtx,
        data: {
          connectionId: string;
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
        return await recordGroupAuditEvent(ctx, data);
      },
      list: async (
        ctx: ComponentReadCtx,
        data: { connectionId?: string; groupId?: string; limit?: number },
      ) => {
        return await ctx.runQuery(
          config.component.public.groupAuditEventList,
          data,
        );
      },
    },
    webhook: {
      endpoint: {
        get: async (ctx: ComponentReadCtx, endpointId: string) => {
          return await ctx.runQuery(
            config.component.public.groupWebhookEndpointGet,
            { endpointId },
          );
        },
        create: async (
          ctx: ComponentCtx,
          data: {
            connectionId: string;
            url: string;
            secret: string;
            subscriptions: string[];
            createdByUserId?: string;
          },
        ) => {
          const connection = await ctx.runQuery(
            config.component.public.groupConnectionGet,
            {
              connectionId: data.connectionId,
            },
          );
          if (connection === null) {
            throw Cv.error({
              code: "INVALID_PARAMETERS",
              message: "Connection not found.",
            });
          }
          const secretHash = await sha256(data.secret);
          const endpointId = (await ctx.runMutation(
            config.component.public.groupWebhookEndpointCreate,
            {
              connectionId: connection._id,
              groupId: connection.groupId,
              url: data.url,
              secretHash,
              subscriptions: data.subscriptions,
              createdByUserId: data.createdByUserId,
            },
          )) as string;
          await recordGroupAuditEvent(ctx, {
            connectionId: connection._id,
            groupId: connection.groupId,
            eventType: "group.sso.webhook.endpoint.created",
            actorType: data.createdByUserId ? "user" : "system",
            actorId: data.createdByUserId,
            subjectType: "group_webhook_endpoint",
            subjectId: endpointId,
            ok: true,
          });
          return { endpointId };
        },
        list: async (ctx: ComponentReadCtx, connectionId: string) => {
          return await ctx.runQuery(
            config.component.public.groupWebhookEndpointList,
            { connectionId },
          );
        },
        disable: async (ctx: ComponentCtx, endpointId: string) => {
          await ctx.runMutation(
            config.component.public.groupWebhookEndpointUpdate,
            { endpointId, data: { status: "disabled" } },
          );
          return { endpointId };
        },
      },
      emit: async (
        ctx: ComponentCtx,
        data: {
          connectionId: string;
          eventType: string;
          payload: Record<string, unknown>;
          auditEventId?: string;
        },
      ) => {
        await emitGroupWebhookDeliveries(ctx, data);
      },
      delivery: {
        list: async (
          ctx: ComponentReadCtx,
          data: { connectionId: string; limit?: number },
        ) => {
          return await ctx.runQuery(
            (config.component.public as any).groupWebhookDeliveryList,
            data,
          );
        },
        listReady: async (ctx: ComponentReadCtx, limit?: number) => {
          return await ctx.runQuery(
            config.component.public.groupWebhookDeliveryListReady,
            { now: Date.now(), limit },
          );
        },
        markDelivered: async (
          ctx: ComponentCtx,
          deliveryId: string,
          responseStatus?: number,
        ) => {
          await ctx.runMutation(
            config.component.public.groupWebhookDeliveryPatch,
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
            config.component.public.groupWebhookDeliveryPatch,
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
