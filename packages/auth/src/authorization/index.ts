/**
 * Lightweight authorization helpers.
 *
 * @module
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
