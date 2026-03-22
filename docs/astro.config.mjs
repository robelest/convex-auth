import starlight from "@astrojs/starlight";
// @ts-check
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

export default defineConfig({
  site: "https://convex-auth.pages.dev",
  vite: { plugins: [tailwindcss()] },
  integrations: [
    starlight({
      title: "convex-auth",
      description:
        "Component-first authentication for Convex. One component, one setup API, full TypeScript support.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/robelest/convex-auth",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/robelest/convex-auth/edit/main/docs/",
      },
      lastUpdated: true,
      plugins: [starlightLlmsTxt()],
      expressiveCode: {
        themes: ["github-dark-dimmed", "github-light"],
        styleOverrides: {
          borderRadius: "0",
          frames: { frameBoxShadowCssValue: "none" },
        },
      },
      customCss: ["./src/styles/global.css", "./src/styles/overrides.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { slug: "getting-started/installation" },
            { slug: "getting-started/providers" },
            { slug: "getting-started/environment" },
          ],
        },
        {
          label: "Integration",
          items: [
            { slug: "integration/context" },
            { slug: "integration/fluent-convex" },
          ],
        },
        {
          label: "SSR",
          items: [
            { slug: "ssr/overview" },
            { slug: "ssr/sveltekit" },
            { slug: "ssr/tanstack" },
            { slug: "ssr/nextjs" },
          ],
        },
        {
          label: "API Reference",
          items: [
            { slug: "api/user" },
            { slug: "api/session" },
            { slug: "api/account" },
            { slug: "api/group" },
            { slug: "api/member" },
            { slug: "api/invite" },
            { slug: "api/key" },
          ],
        },
        {
          label: "Enterprise SSO",
          items: [
            { slug: "sso/overview" },
            { slug: "sso/connection" },
            { slug: "sso/oidc" },
            { slug: "sso/saml" },
            { slug: "sso/scim" },
            { slug: "sso/audit" },
            { slug: "sso/webhook" },
          ],
        },
        {
          label: "Guides",
          items: [
            { slug: "guides/multi-access" },
            { slug: "guides/device-flow" },
            { slug: "guides/authorization" },
            { slug: "guides/production" },
          ],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/config" },
            { slug: "reference/errors" },
            { slug: "reference/cli" },
            { slug: "reference/architecture" },
          ],
        },
      ],
    }),
  ],
});
