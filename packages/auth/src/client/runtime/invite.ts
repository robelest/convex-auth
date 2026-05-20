/** @internal */
export function createInviteManager(args: {
  param: (name: string) => string | null;
  storageGet: (name: string) => Promise<string | null>;
  storageSet: (name: string, value: string) => Promise<boolean>;
  storageRemove: (name: string) => Promise<boolean>;
  cleanUrlParams: (params: string[]) => void;
  tokenKey: string;
  emailKey: string;
}) {
  const { param, storageGet, storageSet, storageRemove, cleanUrlParams, tokenKey, emailKey } = args;

  let pendingInvite: { token: string; email: string | null } | null = null;

  const urlInviteToken = param("invite");
  if (urlInviteToken) {
    pendingInvite = { token: urlInviteToken, email: param("email") };
  }

  const initPromise: Promise<void> = urlInviteToken
    ? Promise.resolve()
    : (async () => {
        const storedToken = await storageGet(tokenKey);
        if (storedToken && !pendingInvite) {
          pendingInvite = {
            token: storedToken,
            email: (await storageGet(emailKey)) ?? null,
          };
          void storageRemove(tokenKey);
          void storageRemove(emailKey);
        }
      })();

  return {
    getPendingInvite() {
      return pendingInvite;
    },
    /** Resolves once the storage-restore step has completed. */
    ready() {
      return initPromise;
    },
    async persistInvite() {
      await initPromise;
      if (!pendingInvite) return;
      await storageSet(tokenKey, pendingInvite.token);
      if (pendingInvite.email) {
        await storageSet(emailKey, pendingInvite.email);
      }
    },
    async acceptInvite(): Promise<{ token: string }> {
      await initPromise;
      if (!pendingInvite) {
        throw new Error("No pending invite to accept.");
      }
      const { token } = pendingInvite;
      pendingInvite = null;
      void storageRemove(tokenKey);
      void storageRemove(emailKey);
      cleanUrlParams(["invite", "email"]);
      return { token };
    },
  };
}
