/**
 * Public Convex `returns:` validators for the auth read surface.
 *
 * These back the `auth.v` namespace on the {@link createAuth} result.
 * Consumers set them as their function `returns:` so client-side
 * `useQuery` inference flows end-to-end with zero hand-rolled validators
 * or DTO mappers. The `extend` field on User/Group/GroupMember is
 * replaced with the validator the consumer supplied via
 * `createAuth({ extend: { ... } })`, so `viewer.extend.<field>` is fully
 * typed instead of `any`.
 *
 * @module
 */

import { Infer, v, Validator } from "convex/values";

import {
  vGroupInviteDoc,
  vGroupMemberDoc,
  vGroupDoc,
  vPaginated,
  vUserDoc,
  vUserEmailDoc,
} from "../component/model";

/**
 * Validators a consumer may supply for the `extend` field of each table.
 *
 * Passed as `createAuth({ extend })`. Every entry is optional; a missing
 * entry falls back to `v.any()`, preserving the untyped default.
 */
export type AuthExtendValidators = {
  /** Shape of `User.extend`. */
  User?: Validator<any, any, any>;
  /** Shape of `Group.extend`. */
  Group?: Validator<any, any, any>;
  /** Shape of `GroupMember.extend`. */
  GroupMember?: Validator<any, any, any>;
};

type ExtendFor<
  TExtend extends AuthExtendValidators,
  K extends keyof AuthExtendValidators,
> = TExtend[K] extends Validator<any, any, any>
  ? TExtend[K]
  : ReturnType<typeof v.any>;

const docWithExtend = <
  Fields extends Record<string, Validator<any, any, any>>,
  E extends Validator<any, any, any>,
>(
  fields: Fields,
  extend: E,
) =>
  v.object({
    ...(fields as Omit<Fields, "extend">),
    extend: v.optional(extend),
  });

/**
 * Build the `auth.v.*` validator namespace from the consumer's `extend`
 * config.
 *
 * `vUserDoc`/`vGroupDoc`/`vGroupMemberDoc` already declare an
 * `extend: v.optional(v.any())` field; this rebuilds each with the
 * supplied validator so the inferred type carries the real shape while
 * the runtime validator still accepts the stored document.
 *
 * @typeParam TExtend - The consumer's per-table `extend` validators.
 * @param extend - The `extend` map from `createAuth` config. Defaults to
 *   an empty object (all `extend` fields stay `v.any()`).
 * @returns The `auth.v` namespace: `user`, `group`, `member`, `invite`,
 *   `viewer`, `viewerWithGroups`, and the `list` page-wrapper helper.
 *
 * @example
 * ```ts
 * const av = buildAuthValidators({
 *   User: v.object({ stripeCustomerId: v.optional(v.string()) }),
 * });
 * // Infer<typeof av.viewer> -> User document with typed `extend`
 * ```
 */
export function buildAuthValidators<TExtend extends AuthExtendValidators>(
  extend: TExtend = {} as TExtend,
) {
  const user = docWithExtend<typeof vUserDoc.fields, ExtendFor<TExtend, "User">>(
    vUserDoc.fields,
    (extend.User ?? v.any()) as ExtendFor<TExtend, "User">,
  );
  const group = docWithExtend<typeof vGroupDoc.fields, ExtendFor<TExtend, "Group">>(
    vGroupDoc.fields,
    (extend.Group ?? v.any()) as ExtendFor<TExtend, "Group">,
  );
  const member = docWithExtend<
    typeof vGroupMemberDoc.fields,
    ExtendFor<TExtend, "GroupMember">
  >(
    vGroupMemberDoc.fields,
    (extend.GroupMember ?? v.any()) as ExtendFor<TExtend, "GroupMember">,
  );
  const invite = vGroupInviteDoc;
  const email = vUserEmailDoc;
  const viewer = v.union(user, v.null());

  return {
    /** Single User document validator (extend-aware). */
    user,
    /** Single Group document validator (extend-aware). */
    group,
    /** Single GroupMember document validator (extend-aware). */
    member,
    /** Single GroupInvite document validator. */
    invite,
    /** Single UserEmail document validator. */
    email,
    /** `User | null` — for a `viewer`/current-user query. */
    viewer,
    /** Wrap any item validator in the `{ items, nextCursor }` page shape. */
    list: vPaginated,
  };
}

/**
 * The `auth.v` namespace type, parameterized by the consumer's `extend`.
 *
 * @typeParam TExtend - The consumer's per-table `extend` validators.
 */
export type AuthValidators<TExtend extends AuthExtendValidators = {}> = ReturnType<
  typeof buildAuthValidators<TExtend>
>;

/**
 * Inferred current-user document type (extend-aware).
 *
 * @typeParam TExtend - The consumer's per-table `extend` validators.
 */
export type Viewer<TExtend extends AuthExtendValidators = {}> = Infer<
  AuthValidators<TExtend>["user"]
>;
/**
 * Inferred Group document type (extend-aware).
 *
 * @typeParam TExtend - The consumer's per-table `extend` validators.
 */
export type Group<TExtend extends AuthExtendValidators = {}> = Infer<
  AuthValidators<TExtend>["group"]
>;
/**
 * Inferred GroupMember document type (extend-aware).
 *
 * @typeParam TExtend - The consumer's per-table `extend` validators.
 */
export type Membership<TExtend extends AuthExtendValidators = {}> = Infer<
  AuthValidators<TExtend>["member"]
>;
