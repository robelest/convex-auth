import { createAccount } from "../dist/server/index";
import { components, internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";

const TEST_USER_EMAIL = "secret@secret.com";

export const getTestUser = internalQuery({
  args: {},
  handler: async (ctx) => {
    const account = await ctx.runQuery(components.auth.public.accountGet, {
      provider: "secret",
      providerAccountId: TEST_USER_EMAIL,
    });
    if (account === null) {
      return null;
    }
    return await ctx.runQuery(components.auth.public.userGetById, {
      userId: account.userId,
    });
  },
});

export const init = internalAction({
  args: {},
  handler: async (ctx) => {
    const existingUser = await ctx.runQuery(internal.tests.getTestUser);
    if (existingUser !== null) {
      console.info("Test user already exists, skipping creation");
      return;
    }
    await createAccount(ctx, {
      provider: "secret",
      account: { id: TEST_USER_EMAIL },
      profile: { email: TEST_USER_EMAIL },
    });
    console.info("Test user created");
  },
});
