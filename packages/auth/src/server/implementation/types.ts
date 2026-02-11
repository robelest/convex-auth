import {
  DataModelFromSchemaDefinition,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  TableNamesInDataModel,
} from "convex/server";
import { GenericId } from "convex/values";
import { GenericDoc } from "../convex_types.js";
import schema from "../../component/schema.js";

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
