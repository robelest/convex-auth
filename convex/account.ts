import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { auth } from "./auth/core";
import { authUserMutation, authUserQuery } from "./functions";

const passkeySummary = v.object({
  passkeyId: v.string(),
  name: v.union(v.string(), v.null()),
  deviceType: v.string(),
  backedUp: v.boolean(),
  createdAt: v.number(),
  lastUsedAt: v.union(v.number(), v.null()),
});

const apiKeyScope = v.object({
  resource: v.string(),
  actions: v.array(v.string()),
});

const apiKeySummary = v.object({
  keyId: v.string(),
  prefix: v.string(),
  name: v.string(),
  revoked: v.boolean(),
  createdAt: v.number(),
  lastUsedAt: v.union(v.number(), v.null()),
  scopes: v.array(apiKeyScope),
});

async function requireOwnedPasskey(ctx: any, userId: string, passkeyId: string) {
  const passkeys = await auth.account.passkey.list(ctx, { userId });
  const passkey = passkeys.find((item: any) => item._id === passkeyId);
  if (!passkey) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Passkey not found.",
    });
  }
  return passkey;
}

async function requireOwnedApiKey(ctx: any, userId: string, keyId: string) {
  const key = await auth.key.get(ctx, { id: keyId });
  if (!key || key.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "API key not found.",
    });
  }
  return key;
}

export const listPasskeys = authUserQuery({
  args: {},
  returns: v.array(passkeySummary),
  handler: async (ctx) => {
    const userId = ctx.auth.userId;
    const passkeys = await auth.account.passkey.list(ctx, {
      userId,
    });
    return passkeys.map((passkey: any) => ({
      passkeyId: passkey._id,
      name: passkey.name ?? null,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt ?? null,
    }));
  },
});

export const renamePasskey = authUserMutation({
  args: { passkeyId: v.string(), name: v.string() },
  returns: v.object({ passkeyId: v.string() }),
  handler: async (ctx, args) => {
    const userId = ctx.auth.userId;
    await requireOwnedPasskey(ctx, userId, args.passkeyId);
    return await auth.account.passkey.update(ctx, {
      id: args.passkeyId,
      patch: { name: args.name.trim() },
    });
  },
});

export const deletePasskey = authUserMutation({
  args: { passkeyId: v.string() },
  returns: v.object({ passkeyId: v.string() }),
  handler: async (ctx, args) => {
    const userId = ctx.auth.userId;
    await requireOwnedPasskey(ctx, userId, args.passkeyId);
    return await auth.account.passkey.remove(ctx, { id: args.passkeyId });
  },
});

export const listApiKeys = authUserQuery({
  args: {},
  returns: v.array(apiKeySummary),
  handler: async (ctx) => {
    const userId = ctx.auth.userId;
    const result = await auth.key.list(ctx, {
      where: { userId },
      paginationOpts: { numItems: 20, cursor: null },
      orderBy: "lastUsedAt",
      order: "desc",
    });
    return result.page.map((key: any) => ({
      keyId: key._id,
      prefix: key.prefix,
      name: key.name,
      revoked: key.revoked,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt ?? null,
      scopes: key.scopes,
    }));
  },
});

export const createApiKey = authUserMutation({
  args: {
    name: v.string(),
    issueRead: v.boolean(),
    issueWrite: v.boolean(),
  },
  returns: v.object({ keyId: v.string(), secret: v.string() }),
  handler: async (ctx, args) => {
    const userId = ctx.auth.userId;
    const scopeActions = [
      ...(args.issueRead ? ["read"] : []),
      ...(args.issueWrite ? ["write"] : []),
    ];
    const scopes = scopeActions.length === 0 ? [] : [{ resource: "issues", actions: scopeActions }];
    const result = await auth.key.create(ctx, {
      data: {
        userId,
        name: args.name.trim(),
        scopes,
      },
    });
    return { keyId: result.id, secret: result.secret };
  },
});

export const revokeApiKey = authUserMutation({
  args: { keyId: v.string() },
  returns: v.object({ keyId: v.string() }),
  handler: async (ctx, args) => {
    const userId = ctx.auth.userId;
    await requireOwnedApiKey(ctx, userId, args.keyId);
    await auth.key.revoke(ctx, { id: args.keyId });
    return { keyId: args.keyId };
  },
});

export const hasPassword = authUserQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const accounts = await ctx.runQuery(components.auth.account.list, {
      userId: ctx.auth.userId,
    });
    return accounts.some((account: any) => account.provider === "password");
  },
});
