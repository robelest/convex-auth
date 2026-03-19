declare module "@robelest/samlify" {
  export const Constants: {
    namespace: {
      binding: {
        redirect: string;
        post: string;
      };
    };
  };

  export function setSchemaValidator(validator: {
    validate: (xml: string) => Promise<string>;
  }): void;

  export function IdentityProvider(options: { metadata: string }): {
    entityMeta: {
      getEntityID(): string;
      getSingleSignOnService(binding: string): string | undefined;
      getSingleLogoutService(binding: string): string | undefined;
      getX509Certificate(use: string): string | string[] | null;
      getNameIDFormat(): string[] | string | undefined;
      isWantAuthnRequestsSigned(): boolean;
    };
  };

  export function ServiceProvider(options: Record<string, unknown>): {
    getMetadata(): string;
    createLoginRequest(
      idp: unknown,
      binding: unknown,
    ):
      | Promise<{
          id: string;
          context: string;
          entityEndpoint?: string;
        }>
      | {
          id: string;
          context: string;
          entityEndpoint?: string;
        };
    parseLoginResponse(
      idp: unknown,
      binding: unknown,
      request: { query: Record<string, string>; body: Record<string, string> },
    ): Promise<unknown>;
    parseLogoutRequest(
      idp: unknown,
      binding: unknown,
      request: { query: Record<string, string>; body: Record<string, string> },
    ): Promise<unknown>;
  };
}
