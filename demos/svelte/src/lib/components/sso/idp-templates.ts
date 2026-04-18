export type IdpField = {
  key: string;
  label: string;
  placeholder: string;
  suffix?: string;
  type?: "text" | "password";
};

export type IdpTemplate = {
  id: string;
  label: string;
  protocols: Array<"oidc" | "saml">;
  oidcFields: IdpField[];
  buildDiscoveryUrl: (values: Record<string, string>) => string;
  helpText: string;
};

export const idpTemplates: IdpTemplate[] = [
  {
    id: "okta",
    label: "Okta",
    protocols: ["oidc", "saml"],
    oidcFields: [
      {
        key: "domain",
        label: "Okta domain",
        placeholder: "acme",
        suffix: ".okta.com",
      },
      {
        key: "clientId",
        label: "Client ID",
        placeholder: "0oaXXXXXXXXXX",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        placeholder: "",
        type: "password",
      },
    ],
    buildDiscoveryUrl: (v) => `https://${v.domain}.okta.com/.well-known/openid-configuration`,
    helpText:
      "Okta Admin \u2192 Applications \u2192 your app \u2192 General tab \u2192 Client Credentials",
  },
  {
    id: "azure",
    label: "Azure AD",
    protocols: ["oidc", "saml"],
    oidcFields: [
      {
        key: "tenantId",
        label: "Tenant ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
      {
        key: "clientId",
        label: "Client ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        placeholder: "",
        type: "password",
      },
    ],
    buildDiscoveryUrl: (v) =>
      `https://login.microsoftonline.com/${v.tenantId}/v2.0/.well-known/openid-configuration`,
    helpText: "Azure Portal \u2192 App registrations \u2192 your app \u2192 Overview",
  },
  {
    id: "google",
    label: "Google Workspace",
    protocols: ["oidc", "saml"],
    oidcFields: [
      {
        key: "clientId",
        label: "Client ID",
        placeholder: "XXXXX.apps.googleusercontent.com",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        placeholder: "",
        type: "password",
      },
    ],
    buildDiscoveryUrl: () => "https://accounts.google.com/.well-known/openid-configuration",
    helpText: "Google Cloud Console \u2192 APIs & Services \u2192 Credentials",
  },
  {
    id: "custom",
    label: "Custom",
    protocols: ["oidc", "saml"],
    oidcFields: [
      {
        key: "discoveryUrl",
        label: "Discovery URL",
        placeholder: "https://idp.example.com/.well-known/openid-configuration",
      },
      {
        key: "clientId",
        label: "Client ID",
        placeholder: "",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        placeholder: "",
        type: "password",
      },
    ],
    buildDiscoveryUrl: (v) => v.discoveryUrl ?? "",
    helpText: "Check your identity provider's documentation",
  },
];
