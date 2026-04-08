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
      { title: "Fluent Convex", slug: "/integration/fluent-convex" },
      { title: "Device Flow (RFC 8628)", slug: "/guides/device-flow" },
      { title: "Production Deploy", slug: "/guides/production" },
    ],
  },
  {
    label: "Group SSO",
    items: [
      { title: "SSO Overview", slug: "/sso/overview" },
      { title: "Group SSO RPC", slug: "/sso/rpc" },
      { title: "auth.group.sso.connection", slug: "/sso/connection" },
      { title: "auth.group.sso.oidc", slug: "/sso/oidc" },
      { title: "auth.group.sso.saml", slug: "/sso/saml" },
      { title: "auth.group.sso.scim", slug: "/sso/scim" },
      { title: "auth.group.sso.audit", slug: "/sso/audit" },
      { title: "auth.group.sso.webhook", slug: "/sso/webhook" },
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
      { title: "Error Codes", slug: "/reference/errors" },
      { title: "CLI Reference", slug: "/reference/cli" },
      { title: "Architecture", slug: "/reference/architecture" },
    ],
  },
];

/** Flat list of all items in sidebar order, for prev/next navigation */
export const allPages = sidebar.flatMap((group) => group.items);

export function getPrevNext(currentSlug: string) {
  const normalized = currentSlug.replace(/\/$/, "");
  const idx = allPages.findIndex((p) => p.slug === normalized);
  return {
    prev: idx > 0 ? allPages[idx - 1] : null,
    next: idx < allPages.length - 1 ? allPages[idx + 1] : null,
  };
}
