export class AuthFlowError extends Error {
  readonly code: string;

  constructor({ code, message }: { readonly code: string; readonly message: string }) {
    super(message);
    this.code = code;
    this.name = "AuthFlowError";
  }
}

/** @internal */
export const authFlowError = (code: string, message: string) =>
  new AuthFlowError({ code, message });
