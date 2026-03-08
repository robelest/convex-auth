import { z } from "zod/v4";

export const MAX_ID_LENGTH = 128;
export const MAX_GROUP_NAME_LENGTH = 80;
export const MAX_GROUP_DESCRIPTION_LENGTH = 280;
export const MAX_MESSAGE_BODY_LENGTH = 2000;
export const MAX_API_KEY_NAME_LENGTH = 80;
export const MAX_INVITE_TOKEN_LENGTH = 256;

export const emptyInput = z.object({}).strict();

export const nonEmptyId = z.string().trim().min(1).max(MAX_ID_LENGTH);

export const groupIdInput = z.object({ groupId: nonEmptyId }).strict();

export const createGroupInput = z
  .object({
    name: z.string().trim().min(1).max(MAX_GROUP_NAME_LENGTH),
    description: z.string().trim().max(MAX_GROUP_DESCRIPTION_LENGTH).optional(),
  })
  .strict();

export const messageInput = z
  .object({
    body: z.string().trim().min(1).max(MAX_MESSAGE_BODY_LENGTH),
    groupId: nonEmptyId.optional(),
  })
  .strict();

export const sendAsUserInput = z
  .object({
    userId: nonEmptyId,
    body: z.string().trim().min(1).max(MAX_MESSAGE_BODY_LENGTH),
  })
  .strict();

export const listMessagesInput = z
  .object({
    groupId: nonEmptyId.optional(),
  })
  .strict();

const inviteTokenInput = z.string().trim().min(16).max(MAX_INVITE_TOKEN_LENGTH);

export const createInviteInput = z
  .object({
    groupId: nonEmptyId,
    email: z.string().trim().email(),
    role: z.string().trim().min(1).max(MAX_GROUP_NAME_LENGTH).optional(),
    expiresInHours: z
      .number()
      .int()
      .positive()
      .max(24 * 30)
      .optional(),
  })
  .strict();

export const acceptInviteInput = z
  .object({
    token: inviteTokenInput,
  })
  .strict();

export const createKeyInput = z
  .object({
    name: z.string().trim().min(1).max(MAX_API_KEY_NAME_LENGTH),
  })
  .strict();

export const revokeKeyInput = z.object({ keyId: nonEmptyId }).strict();

export const resetInput = z
  .object({
    forReal: z.literal("I know what I'm doing"),
  })
  .strict();

export const nullOutput = z.null();

export const unknownRecordOutput = z.record(z.string(), z.unknown());

export const unknownRecordListOutput = z.array(unknownRecordOutput);

export const nullableUnknownRecordOutput = unknownRecordOutput.nullable();

export const inviteEmailOutput = z
  .object({
    inviteId: nonEmptyId,
    email: z.string().email(),
    expiresTime: z.number().nullable(),
  })
  .strict();

export const acceptInviteOutput = z
  .object({
    inviteId: nonEmptyId,
    groupId: nonEmptyId.nullable(),
    memberId: nonEmptyId.nullable(),
    inviteStatus: z.string().optional(),
    membershipStatus: z.string().optional(),
  })
  .strict();
