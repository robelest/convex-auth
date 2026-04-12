import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError } from "convex/values";

import { getGroup } from "../contract";
import type {
  ConvexAuthMaterializedConfig,
  GroupConnectionPolicy,
  GroupConnectionPolicyPatch,
} from "../types";
import { patchGroupConnectionPolicy } from "./policy";

type ComponentCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
type ComponentReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;

const convexError = (data: { code: string; message: string }) =>
  new ConvexError(data);

type PolicyDeps = {
  config: ConvexAuthMaterializedConfig;
  loadGroupPolicyOrThrow: (
    ctx: ComponentReadCtx,
    groupId: string,
  ) => Promise<GroupConnectionPolicy>;
  validateGroupConnectionPolicy: (
    policy: GroupConnectionPolicy,
  ) => Array<{ name: string; ok: boolean; message?: string }>;
  recordGroupAuditEvent: (
    ctx: ComponentCtx,
    data: {
      connectionId?: string;
      groupId: string;
      eventType: string;
      actorType: "user" | "system" | "scim" | "api_key" | "webhook";
      actorId?: string;
      subjectType: string;
      subjectId?: string;
      ok: boolean;
      requestId?: string;
      ip?: string;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<string>;
};

export function createGroupPolicyDomain(deps: PolicyDeps) {
  const {
    config,
    loadGroupPolicyOrThrow,
    validateGroupConnectionPolicy,
    recordGroupAuditEvent,
  } = deps;

  return {
    get: async (ctx: ComponentReadCtx, groupId: string) => {
      return await loadGroupPolicyOrThrow(ctx, groupId);
    },
    update: async (
      ctx: ComponentCtx,
      groupId: string,
      patch: GroupConnectionPolicyPatch,
    ) => {
      const group = await getGroup(ctx, config.component.public, groupId);
      if (!group) {
        throw convexError({
          code: "INVALID_PARAMETERS",
          message: "Group not found.",
        });
      }
      const policy = patchGroupConnectionPolicy(group.policy, patch);
      await ctx.runMutation(config.component.public.groupUpdate, {
        groupId,
        data: { policy },
      });
      await recordGroupAuditEvent(ctx, {
        groupId,
        eventType: "group.sso.policy.updated",
        actorType: "system",
        subjectType: "group_policy",
        subjectId: groupId,
        ok: true,
        metadata: { version: policy.version },
      });
      return policy;
    },
    validate: async (ctx: ComponentReadCtx, groupId: string) => {
      const group = await getGroup(ctx, config.component.public, groupId);
      if (!group) {
        return {
          ok: false,
          groupId,
          checks: [
            {
              name: "group_exists",
              ok: false,
              message: "Group not found.",
            },
          ],
        };
      }
      const policy = await loadGroupPolicyOrThrow(ctx, groupId);
      const checks = validateGroupConnectionPolicy(policy);
      return {
        ok: checks.every((check: { ok: boolean }) => check.ok),
        groupId,
        policy,
        checks,
      };
    },
  };
}
