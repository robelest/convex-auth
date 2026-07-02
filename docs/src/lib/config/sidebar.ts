export interface SidebarItem {
  title: string;
  slug: string;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export const sidebar: SidebarGroup[] = [
  {
    label: "Getting Started",
    items: [
      { title: "Installation", slug: "/getting-started/installation" },
      { title: "Providers", slug: "/getting-started/providers" },
      { title: "Environment Variables", slug: "/getting-started/environment" },
    ],
  },
  {
    label: "Guides",
    items: [
      { title: "Authorization Patterns", slug: "/guides/authorization" },
      { title: "Multi-Access", slug: "/guides/multi-access" },
      { title: "Context Enrichment", slug: "/integration/context" },
      { title: "React Hooks", slug: "/client/react" },
      { title: "Svelte", slug: "/client/svelte" },
      { title: "Fluent Convex", slug: "/integration/fluent-convex" },
      { title: "Device Flow (RFC 8628)", slug: "/guides/device-flow" },
      { title: "MCP Server (OAuth 2.1)", slug: "/guides/mcp-server" },
      { title: "Native Apps", slug: "/guides/native-apps" },
      { title: "Production Deploy", slug: "/guides/production" },
    ],
  },
  {
    label: "Group SSO",
    items: [
      { title: "SSO Overview", slug: "/connection/overview" },
      { title: "Group SSO RPC", slug: "/connection/rpc" },
      { title: "auth.connection", slug: "/connection/connection" },
      { title: "auth.connection.policy", slug: "/connection/policy" },
      { title: "auth.connection.oidc", slug: "/connection/oidc" },
      { title: "auth.connection.saml", slug: "/connection/saml" },
      { title: "auth.connection.scim", slug: "/connection/scim" },
      { title: "auth.event audit", slug: "/connection/audit" },
      { title: "auth.connection.webhook", slug: "/connection/webhook" },
    ],
  },
  {
    label: "SSR",
    items: [
      { title: "SSR Overview", slug: "/ssr/overview" },
      { title: "SvelteKit", slug: "/ssr/sveltekit" },
      { title: "TanStack Start", slug: "/ssr/tanstack" },
      { title: "Next.js", slug: "/ssr/nextjs" },
    ],
  },
  {
    label: "API Reference",
    items: [
      { title: "auth.user", slug: "/api/user" },
      { title: "auth.session", slug: "/api/session" },
      { title: "auth.account", slug: "/api/account" },
      { title: "auth.group", slug: "/api/group" },
      { title: "auth.member", slug: "/api/member" },
      { title: "auth.invite", slug: "/api/invite" },
      { title: "auth.key", slug: "/api/key" },
      { title: "Configuration", slug: "/reference/config" },
      { title: "Typed Returns (auth.v)", slug: "/reference/typed-returns" },
      { title: "Error Codes", slug: "/reference/errors" },
      { title: "CLI Reference", slug: "/reference/cli" },
      { title: "Data Migrations", slug: "/reference/migrations" },
      { title: "Architecture", slug: "/reference/architecture" },
      { title: ".well-known", slug: "/reference/well-known" },
    ],
  },
];
