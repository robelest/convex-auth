/**
 * Lightweight authorization helpers.
 *
 * @module
 */

/**
 * Define typed role definitions for authorization.
 *
 * Transforms a declarative roles configuration object into a normalized
 * map where each role has an `id` (matching its key), an optional `label`,
 * and a typed `grants` array. The returned object is fully type-safe:
 * role IDs and grant strings are narrowed to their literal types, so
 * `member.resolve()` and `member.create()` calls are checked at compile time.
 * This is the canonical way to define role metadata for the auth library.
 *
 * @param roles - An object mapping role IDs to their configuration.
 *   Each entry must include a `grants` array of permission strings and
 *   may include an optional human-readable `label`.
 * @typeParam TRoles - The object literal shape of your role definitions.
 * @returns An object with the same keys as `roles`, where each value
 *   is `{ id, label?, grants }` — `id` is the role key as a string,
 *   and `grants` is a mutable array of the declared grant strings.
 *
 * @example
 * ```ts
 * import { defineRoles } from "@robelest/convex-auth/authorization";
 *
 * const roles = defineRoles({
 *   admin: { label: "Administrator", grants: ["issues:write", "members:manage"] },
 *   member: { label: "Member", grants: ["issues:write"] },
 *   viewer: { grants: ["issues:read"] },
 * });
 *
 * // roles.admin.id   === "admin"
 * // roles.admin.grants === ["issues:write", "members:manage"]
 *
 * // Pass to createAuth:
 * const auth = createAuth(components.auth, {
 *   providers: [...],
 *   authorization: { roles },
 * });
 * ```
 *
 * @example
 * ```ts
 * type RoleId = keyof typeof roles;
 * // RoleId = "admin" | "member" | "viewer"
 * ```
 *
 * @see {@link ConvexAuthConfig}
 */
export function defineRoles<
  const TRoles extends Record<
    string,
    { label?: string; grants: readonly string[] }
  >,
>(
  roles: TRoles,
): {
  [K in keyof TRoles]: {
    id: K & string;
    label?: TRoles[K]["label"];
    grants: Array<TRoles[K]["grants"][number] & string>;
  };
} {
  return Object.fromEntries(
    Object.entries(roles).map(([id, role]) => [
      id,
      {
        id,
        ...(role.label ? { label: role.label } : {}),
        grants: [...role.grants],
      },
    ]),
  ) as {
    [K in keyof TRoles]: {
      id: K & string;
      label?: TRoles[K]["label"];
      grants: Array<TRoles[K]["grants"][number] & string>;
    };
  };
}
