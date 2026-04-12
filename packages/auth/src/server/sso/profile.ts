type NormalizedProfileInput = {
  id?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  firstName?: string;
  lastName?: string;
  image?: string;
  phone?: string;
  active?: boolean;
  externalId?: string;
  groups?: string[];
  roles?: string[];
  extend?: Record<string, unknown>;
};

/** @internal */
export function normalizeStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
    return values.length > 0 ? values : undefined;
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return undefined;
}

/** @internal */
export function finalizeNormalizedProfile<T extends NormalizedProfileInput>(
  input: T,
) {
  return {
    ...input,
    groups: normalizeStringArray(input.groups),
    roles: normalizeStringArray(input.roles),
    ...(input.extend && Object.keys(input.extend).length > 0
      ? { extend: input.extend }
      : {}),
  };
}
