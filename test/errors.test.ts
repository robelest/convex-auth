import {
  AUTH_ERRORS,
  isAuthError,
  parseAuthError,
  throwAuthError,
} from "@robelest/convex-auth/server/errors";
import { AuthError } from "@robelest/convex-auth/server/fx";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

test("AUTH_ERRORS map has unique string values for all codes", () => {
  const values = Object.values(AUTH_ERRORS);
  expect(values.length).toBeGreaterThan(0);

  for (const value of values) {
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  }

  const uniqueValues = new Set(values);
  expect(uniqueValues.size).toBe(values.length);
});

test("throwAuthError throws ConvexError with code and default message", () => {
  expect(() => throwAuthError("NOT_SIGNED_IN")).toThrow(ConvexError);

  try {
    throwAuthError("NOT_SIGNED_IN");
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    const convexError = error as ConvexError<{
      code: string;
      message: string;
    }>;
    expect(convexError.data.code).toBe("NOT_SIGNED_IN");
    expect(convexError.data.message).toBe(AUTH_ERRORS.NOT_SIGNED_IN);
  }
});

test("throwAuthError accepts custom message override", () => {
  try {
    throwAuthError("INTERNAL_ERROR", "Something specific went wrong");
  } catch (error) {
    const convexError = error as ConvexError<{
      code: string;
      message: string;
    }>;
    expect(convexError.data.code).toBe("INTERNAL_ERROR");
    expect(convexError.data.message).toBe("Something specific went wrong");
  }
});

test("throwAuthError accepts extra context fields", () => {
  try {
    throwAuthError("MISSING_ENV_VAR", undefined, { variable: "SECRET_KEY" });
  } catch (error) {
    const convexError = error as ConvexError<{
      code: string;
      message: string;
      variable: string;
    }>;
    expect(convexError.data.code).toBe("MISSING_ENV_VAR");
    expect(convexError.data.message).toBe(AUTH_ERRORS.MISSING_ENV_VAR);
    expect(convexError.data.variable).toBe("SECRET_KEY");
  }
});

test("isAuthError returns true for structured auth ConvexError", () => {
  const error = new ConvexError({
    code: "NOT_SIGNED_IN",
    message: "You must be signed in to perform this action.",
  });
  expect(isAuthError(error)).toBe(true);
});

test("isAuthError returns false for plain ConvexError with string data", () => {
  const error = new ConvexError("some plain error string");
  expect(isAuthError(error)).toBe(false);
});

test("isAuthError returns false for plain Error", () => {
  const error = new Error("something went wrong");
  expect(isAuthError(error)).toBe(false);
});

test("isAuthError returns false for non-error values", () => {
  expect(isAuthError(null)).toBe(false);
  expect(isAuthError(undefined)).toBe(false);
  expect(isAuthError("string")).toBe(false);
  expect(isAuthError(42)).toBe(false);
  expect(isAuthError({ code: "NOT_SIGNED_IN", message: "msg" })).toBe(false);
});

test("parseAuthError extracts code and message from auth ConvexError", () => {
  const error = new ConvexError({
    code: "INVALID_CREDENTIALS_PROVIDER",
    message: "This provider does not support credential operations.",
  });
  const parsed = parseAuthError(error);
  expect(parsed).not.toBeNull();
  expect(parsed!.code).toBe("INVALID_CREDENTIALS_PROVIDER");
  expect(parsed!.message).toBe(
    "This provider does not support credential operations.",
  );
});

test("parseAuthError extracts code from Fx AuthError", () => {
  const error = new AuthError("NOT_SIGNED_IN");
  const parsed = parseAuthError(error);
  expect(parsed).not.toBeNull();
  expect(parsed!.code).toBe("NOT_SIGNED_IN");
  expect(parsed!.message).toBe(AUTH_ERRORS.NOT_SIGNED_IN);
});

test("parseAuthError extracts code from Fx AuthError with custom message", () => {
  const error = new AuthError("INTERNAL_ERROR", "Custom detail");
  const parsed = parseAuthError(error);
  expect(parsed).not.toBeNull();
  expect(parsed!.code).toBe("INTERNAL_ERROR");
  expect(parsed!.message).toBe("Custom detail");
});

test("parseAuthError returns null code for plain ConvexError with string data", () => {
  const error = new ConvexError("just a plain message");
  const parsed = parseAuthError(error);
  expect(parsed).not.toBeNull();
  expect(parsed!.code).toBeNull();
  expect(parsed!.message).toBe("just a plain message");
});

test("parseAuthError returns null code for plain Error", () => {
  const error = new Error("standard error");
  const parsed = parseAuthError(error);
  expect(parsed).not.toBeNull();
  expect(parsed!.code).toBeNull();
  expect(parsed!.message).toBe("standard error");
});

test("parseAuthError returns null for non-error values", () => {
  expect(parseAuthError(null)).toBeNull();
  expect(parseAuthError(undefined)).toBeNull();
  expect(parseAuthError("string")).toBeNull();
  expect(parseAuthError(42)).toBeNull();
  expect(parseAuthError({ code: "NOT_SIGNED_IN", message: "msg" })).toBeNull();
});

test("AuthError toConvexError converts to structured ConvexError", () => {
  const authError = new AuthError("INVALID_API_KEY");
  const convexError = authError.toConvexError();

  expect(convexError).toBeInstanceOf(ConvexError);
  expect(convexError.data.code).toBe("INVALID_API_KEY");
  expect(convexError.data.message).toBe(AUTH_ERRORS.INVALID_API_KEY);
});

test("AuthError toConvexError includes context fields", () => {
  const authError = new AuthError("MISSING_ENV_VAR", undefined, {
    variable: "API_SECRET",
  });
  const convexError = authError.toConvexError();
  const data = convexError.data as {
    code: string;
    message: string;
    variable: string;
  };
  expect(data.variable).toBe("API_SECRET");
});

test("AuthError has correct _tag", () => {
  const error = new AuthError("INTERNAL_ERROR");
  expect(error._tag).toBe("AuthError");
});

test("roundtrip: throwAuthError -> catch -> parseAuthError", () => {
  try {
    throwAuthError("OAUTH_INVALID_STATE");
  } catch (error) {
    const parsed = parseAuthError(error);
    expect(parsed).not.toBeNull();
    expect(parsed!.code).toBe("OAUTH_INVALID_STATE");
    expect(parsed!.message).toBe(AUTH_ERRORS.OAUTH_INVALID_STATE);
  }
});
