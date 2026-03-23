---
title: Environment Variables
description: Required and optional environment variables for convex-auth.
---

<svelte:head>

  <title>Environment Variables - convex-auth</title>
</svelte:head>

# Environment Variables

## Required

| Variable                     | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `JWT_PRIVATE_KEY`            | Signs session JWTs                          |
| `JWKS`                       | JSON Web Key Set for verification           |
| `AUTH_SECRET_ENCRYPTION_KEY` | Encrypts stored enterprise secrets          |
| `SITE_URL`                   | Frontend URL for OAuth/magic link redirects |

These are set automatically by the CLI setup wizard.

## System (auto-provided by Convex)

| Variable          | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `CONVEX_SITE_URL` | HTTP actions URL. Used as JWT issuer and OAuth callback base. |

## Provider

| Pattern                  | Example              |
| ------------------------ | -------------------- |
| `AUTH_<PROVIDER>_ID`     | `AUTH_GITHUB_ID`     |
| `AUTH_<PROVIDER>_SECRET` | `AUTH_GITHUB_SECRET` |

## Optional

| Variable                            | Purpose                             | Default           |
| ----------------------------------- | ----------------------------------- | ----------------- |
| `AUTH_SESSION_TOTAL_DURATION_MS`    | Max session lifetime                | 30 days           |
| `AUTH_SESSION_INACTIVE_DURATION_MS` | Inactive session timeout            | Provider-specific |
| `AUTH_LOG_LEVEL`                    | `DEBUG` / `INFO` / `WARN` / `ERROR` | `INFO`            |
