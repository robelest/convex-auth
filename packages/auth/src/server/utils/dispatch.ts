/**
 * Map-based dispatch table builder.
 *
 * @module
 */

type AnyHandler = (...args: any[]) => any;

/**
 * Build a dispatch function from a handler record.
 *
 * ```ts
 * const run = createDispatch({
 *   signIn:  (args) => handleSignIn(args),
 *   signOut: (args) => handleSignOut(args),
 * });
 * return await run("signIn", args);
 * ```
 */
export function createDispatch<THandlers extends Record<string, AnyHandler>>(
  handlers: THandlers,
): <K extends string & keyof THandlers>(
  key: K,
  ...args: Parameters<THandlers[K]>
) => ReturnType<THandlers[K]> {
  const map = new Map<string, AnyHandler>(Object.entries(handlers));
  return ((key: string, ...args: unknown[]) => {
    const handler = map.get(key);
    if (!handler) {
      throw new Error(`Unknown dispatch key: "${key}"`);
    }
    return handler(...args);
  }) as never;
}

/**
 * Compose multiple dispatch tables into one.
 *
 * ```ts
 * const dispatch = composeDispatch(coreHandlers, ssoHandlers);
 * ```
 */
export function composeDispatch<
  A extends Record<string, AnyHandler>,
  B extends Record<string, AnyHandler>,
>(a: A, b: B): A & B {
  return { ...a, ...b };
}
