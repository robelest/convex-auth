import { v } from "convex/values";

const vPayloadPrimitive = v.union(v.string(), v.number(), v.boolean(), v.null());

const vPayloadArray = v.array(vPayloadPrimitive);

const vPayloadNestedRecord = v.record(v.string(), v.union(vPayloadPrimitive, vPayloadArray));

const vPayloadValue = v.union(vPayloadPrimitive, vPayloadArray, vPayloadNestedRecord);

export const vPayloadRecord = v.record(v.string(), vPayloadValue);

const vAccountIdentity = v.object({
  type: v.optional(v.string()),
  provider: v.optional(v.string()),
  providerAccountId: v.optional(v.string()),
  protocol: v.optional(v.string()),
  connectionId: v.optional(v.string()),
  subject: v.optional(v.string()),
  issuer: v.optional(v.string()),
  discoveryUrl: v.optional(v.string()),
  entityId: v.optional(v.string()),
});

export const vAccountExtend = v.object({
  identity: v.optional(vAccountIdentity),
  saml: v.optional(
    v.object({
      attributes: v.optional(v.record(v.string(), v.union(v.string(), v.array(v.string())))),
      sessionIndex: v.optional(v.string()),
    }),
  ),
});

type PayloadPrimitive = string | number | boolean | null;

type PayloadValue =
  | PayloadPrimitive
  | PayloadPrimitive[]
  | Record<string, PayloadPrimitive | PayloadPrimitive[]>;

type PayloadRecord = Record<string, PayloadValue>;

export type SignInParams = PayloadRecord;

export type AuthProfile = PayloadRecord & {
  email?: string;
  phone?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

export type AuthAccountExtend = {
  identity?: {
    type?: string;
    provider?: string;
    providerAccountId?: string;
    protocol?: string;
    connectionId?: string;
    subject?: string;
    issuer?: string;
    discoveryUrl?: string;
    entityId?: string;
  };
  saml?: {
    attributes?: Record<string, string | string[]>;
    sessionIndex?: string;
  };
};
