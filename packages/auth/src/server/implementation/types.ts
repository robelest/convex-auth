import {
  DataModelFromSchemaDefinition,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  TableNamesInDataModel,
} from "convex/server";
import { GenericId } from "convex/values";
import { GenericDoc } from "../types";
import schema from "../../component/schema";
import { AuthComponentApi } from "../types";

/** Data model derived from the component schema. */
export type AuthDataModel = DataModelFromSchemaDefinition<typeof schema>;

/** Action context typed to the auth component's data model. */
export type ActionCtx = GenericActionCtx<AuthDataModel>;

/** Mutation context typed to the auth component's data model. */
export type MutationCtx = GenericMutationCtx<AuthDataModel>;

/** Query context typed to the auth component's data model. */
export type QueryCtx = GenericQueryCtx<AuthDataModel>;

/** A document from any table in the auth component schema. */
export type Doc<T extends TableNamesInDataModel<AuthDataModel>> = GenericDoc<
  AuthDataModel,
  T
>;

/** A pair of JWT access token and refresh token. */
export type Tokens = { token: string; refreshToken: string };

/** Session information returned after authentication. */
export type SessionInfo = {
  userId: GenericId<"user">;
  sessionId: GenericId<"session">;
  tokens: Tokens | null;
};

/** Session information with guaranteed non-null tokens. */
export type SessionInfoWithTokens = {
  userId: GenericId<"user">;
  sessionId: GenericId<"session">;
  tokens: Tokens;
};

// ---------------------------------------------------------------------------
// Cross-component document shapes
// ---------------------------------------------------------------------------
// These mirror the component schema tables. They exist so that server-side
// code can work with typed results from cross-component queries/mutations
// instead of casting to `any` at every field access.

export interface TotpDoc {
  _id: string;
  _creationTime: number;
  userId: string;
  secret: ArrayBuffer;
  digits: number;
  period: number;
  verified: boolean;
  name?: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface PasskeyDoc {
  _id: string;
  _creationTime: number;
  userId: string;
  credentialId: string;
  publicKey: ArrayBuffer;
  algorithm: number;
  counter: number;
  transports?: string[];
  deviceType: string;
  backedUp: boolean;
  name?: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface VerifierDoc {
  _id: string;
  _creationTime: number;
  signature?: string;
  sessionId?: string;
}

export interface UserDoc {
  _id: string;
  _creationTime: number;
  email?: string;
  emailVerificationTime?: number;
  phone?: string;
  phoneVerificationTime?: number;
  name?: string;
  image?: string;
  isAnonymous?: boolean;
}

export interface KeyDoc {
  _id: string;
  _creationTime: number;
  userId: string;
  prefix: string;
  hashedKey: string;
  name: string;
  scopes: Array<{ resource: string; actions: string[] }>;
  rateLimit?: { maxRequests: number; windowMs: number };
  rateLimitState?: { attemptsLeft: number; lastAttemptTime: number };
  expiresAt?: number;
  lastUsedAt?: number;
  createdAt: number;
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// Cross-component wrapper context
// ---------------------------------------------------------------------------
// Structural type accepted by all wrappers below.  Works for both action and
// mutation contexts — the only capabilities we need are runQuery / runMutation
// and access to the component API via `auth.config.component`.

/** @internal */
export type ComponentCallCtx = {
  runQuery: GenericActionCtx<AuthDataModel>["runQuery"];
  runMutation: GenericActionCtx<AuthDataModel>["runMutation"];
  auth: { config: { component: AuthComponentApi } };
};

// ---------------------------------------------------------------------------
// Typed wrappers for cross-component calls
// ---------------------------------------------------------------------------
// Each wrapper encapsulates the single `as any` cast at the component
// boundary so that callers get full type safety on both args and return
// values.

// -- User queries --

export async function queryUserById(
  ctx: ComponentCallCtx,
  userId: string,
): Promise<UserDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.userGetById,
    { userId },
  )) as UserDoc | null;
}

export async function queryUserByVerifiedEmail(
  ctx: ComponentCallCtx,
  email: string,
): Promise<UserDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.userFindByVerifiedEmail,
    { email },
  )) as UserDoc | null;
}

// -- Verifier queries / mutations --

export async function queryVerifierById(
  ctx: ComponentCallCtx,
  verifierId: string,
): Promise<VerifierDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.verifierGetById,
    { verifierId },
  )) as VerifierDoc | null;
}

export async function mutateVerifierDelete(
  ctx: ComponentCallCtx,
  verifierId: string,
): Promise<void> {
  await ctx.runMutation(
    ctx.auth.config.component.public.verifierDelete,
    { verifierId },
  );
}

// -- TOTP queries / mutations --

export async function queryTotpById(
  ctx: ComponentCallCtx,
  totpId: string,
): Promise<TotpDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.totpGetById,
    { totpId },
  )) as TotpDoc | null;
}

export async function queryTotpVerifiedByUserId(
  ctx: ComponentCallCtx,
  userId: string,
): Promise<TotpDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.totpGetVerifiedByUserId,
    { userId },
  )) as TotpDoc | null;
}

export async function mutateTotpInsert(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    secret: ArrayBuffer;
    digits: number;
    period: number;
    verified: boolean;
    name?: string;
    createdAt: number;
  },
): Promise<string> {
  return (await ctx.runMutation(
    ctx.auth.config.component.public.totpInsert,
    args,
  )) as string;
}

export async function mutateTotpMarkVerified(
  ctx: ComponentCallCtx,
  totpId: string,
  lastUsedAt: number,
): Promise<void> {
  await ctx.runMutation(
    ctx.auth.config.component.public.totpMarkVerified,
    { totpId, lastUsedAt },
  );
}

export async function mutateTotpUpdateLastUsed(
  ctx: ComponentCallCtx,
  totpId: string,
  lastUsedAt: number,
): Promise<void> {
  await ctx.runMutation(
    ctx.auth.config.component.public.totpUpdateLastUsed,
    { totpId, lastUsedAt },
  );
}

// -- Passkey queries / mutations --

export async function queryPasskeysByUserId(
  ctx: ComponentCallCtx,
  userId: string,
): Promise<PasskeyDoc[]> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.passkeyListByUserId,
    { userId },
  )) as PasskeyDoc[];
}

export async function queryPasskeyByCredentialId(
  ctx: ComponentCallCtx,
  credentialId: string,
): Promise<PasskeyDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.passkeyGetByCredentialId,
    { credentialId },
  )) as PasskeyDoc | null;
}

export async function mutatePasskeyInsert(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    credentialId: string;
    publicKey: ArrayBuffer | ArrayBufferLike;
    algorithm: number;
    counter: number;
    transports?: string[];
    deviceType: string;
    backedUp: boolean;
    name?: string;
    createdAt: number;
  },
): Promise<string> {
  return (await ctx.runMutation(
    ctx.auth.config.component.public.passkeyInsert,
    args,
  )) as string;
}

export async function mutatePasskeyUpdateCounter(
  ctx: ComponentCallCtx,
  passkeyId: string,
  counter: number,
  lastUsedAt: number,
): Promise<void> {
  await ctx.runMutation(
    ctx.auth.config.component.public.passkeyUpdateCounter,
    { passkeyId, counter, lastUsedAt },
  );
}

// -- Key queries / mutations --

export async function mutateKeyInsert(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    prefix: string;
    hashedKey: string;
    name: string;
    scopes: Array<{ resource: string; actions: string[] }>;
    rateLimit?: { maxRequests: number; windowMs: number };
    expiresAt?: number;
  },
): Promise<string> {
  return (await ctx.runMutation(
    ctx.auth.config.component.public.keyInsert,
    args,
  )) as string;
}

export async function queryKeysByUserId(
  ctx: ComponentCallCtx,
  userId: string,
): Promise<KeyDoc[]> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.keyListByUserId,
    { userId },
  )) as KeyDoc[];
}

export async function queryKeyById(
  ctx: ComponentCallCtx,
  keyId: string,
): Promise<KeyDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.keyGetById,
    { keyId },
  )) as KeyDoc | null;
}

export async function mutateKeyPatch(
  ctx: ComponentCallCtx,
  keyId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await ctx.runMutation(
    ctx.auth.config.component.public.keyPatch,
    { keyId, data },
  );
}

export async function mutateKeyDelete(
  ctx: ComponentCallCtx,
  keyId: string,
): Promise<void> {
  await ctx.runMutation(
    ctx.auth.config.component.public.keyDelete,
    { keyId },
  );
}
