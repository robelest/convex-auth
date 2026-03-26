/** @internal */
export function createInviteManager(args: {
  param: (name: string) => string | null;
  storageGet: (name: string) => Promise<string | null>;
  storageSet: (name: string, value: string) => Promise<void>;
  storageRemove: (name: string) => Promise<void>;
  cleanUrlParams: (params: string[]) => void;
  tokenKey: string;
  emailKey: string;
}) {
  const {
    param,
    storageGet,
    storageSet,
    storageRemove,
    cleanUrlParams,
    tokenKey,
    emailKey,
  } = args;

  let pendingInvite: { token: string; email: string | null } | null = null;

  const urlInviteToken = param("invite");
  if (urlInviteToken) {
    pendingInvite = { token: urlInviteToken, email: param("email") };
  } else {
    void (async () => {
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
  }

  return {
    getPendingInvite() {
      return pendingInvite;
    },
    async persistInvite() {
      if (!pendingInvite) return;
      await storageSet(tokenKey, pendingInvite.token);
      if (pendingInvite.email) {
        await storageSet(emailKey, pendingInvite.email);
      }
    },
    async acceptInvite(): Promise<{
      ok: boolean;
      token?: string;
      message?: string;
    }> {
      if (!pendingInvite) return { ok: false, message: "No pending invite" };
      const { token } = pendingInvite;
      pendingInvite = null;
      void storageRemove(tokenKey);
      void storageRemove(emailKey);
      cleanUrlParams(["invite", "email"]);
      return { ok: true, token };
    },
  };
}
