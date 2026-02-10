import { describe, expect, test } from "vitest";
import { convexTest } from "../convex-test";
import schema from "./schema";
import { components } from "../../convex/_generated/api";

describe("auth component", () => {
  test("registers and serves public core functions", async () => {
    const t = convexTest(schema);

    const userId = await t.run(async (ctx) => {
      return await ctx.runMutation(components.auth.public.userInsert, {
        data: { email: "component-user@example.com" },
      });
    });

    const user = await t.run(async (ctx) => {
      return await ctx.runQuery(components.auth.public.userGetById, { userId });
    });

    expect(user).not.toBeNull();
    expect(user?.email).toBe("component-user@example.com");
  });
});
