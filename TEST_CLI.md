# Testing the CLI

## Quick Test (No Deployment Required)

Test the CLI help and option parsing:

```bash
# From packages/auth directory
cd packages/auth

# Test help
node dist/bin.cjs --help

# Test with dry-run flags (won't actually deploy)
node dist/bin.cjs --site-url "http://localhost:5173" --skip-git-check --allow-dirty-git-state
```

## Full Test (Requires Convex Deployment)

### Prerequisites

1. You need a Convex project with `npx convex dev` running
2. The CLI needs to read `CONVEX_DEPLOYMENT` from your environment

### Test Dev Setup

From the **root of a Convex project** (not this repo):

```bash
# Method 1: Run the built CLI directly
node /path/to/convex-auth/packages/auth/dist/bin.cjs --site-url "http://localhost:5173" --skip-git-check

# Method 2: Use npm link (recommended for repeated testing)
cd /path/to/convex-auth/packages/auth
npm link

# Then from your test project:
npx @robelest/convex-auth --site-url "http://localhost:5173"
```

### Test Production Setup

```bash
# Interactive (will prompt for site URL)
node dist/bin.cjs --prod --skip-git-check

# With explicit URL
node dist/bin.cjs --prod --site-url "https://myapp.com" --skip-git-check
```

### Test the Success Messages

The CLI will show different messages based on deployment type:

**Dev deployment:**
- Shows production setup reminder
- Shows provider secrets reminder
- Shows docs link

**Production deployment:**
- Shows simple success message
- Shows docs link only

## Testing with the Example Apps

The repo already has example apps. Use those to test the full flow:

```bash
# Start from repo root
cd examples/vite

# Make sure Convex is running
bun run --cwd ../.. dev:convex

# Test the CLI
node ../../packages/auth/dist/bin.cjs --site-url "http://localhost:5173" --skip-git-check --allow-dirty-git-state
```

This will:
1. Set `SITE_URL` on your dev deployment
2. Generate and set `JWT_PRIVATE_KEY` and `JWKS`
3. Check/scaffold files (may already exist)
4. Show the success message with production setup instructions

## Verify Environment Variables Were Set

```bash
# Check that env vars were set on your deployment
npx convex env get SITE_URL
npx convex env get JWT_PRIVATE_KEY
npx convex env get JWKS
```

## Testing Production Flow End-to-End

If you want to test the full prod flow:

1. **Run CLI for prod:**
   ```bash
   node dist/bin.cjs --prod --site-url "https://test.example.com" --skip-git-check
   ```

2. **Set provider secrets (optional):**
   ```bash
   npx convex env set --prod AUTH_GITHUB_ID "test-id"
   npx convex env set --prod AUTH_GITHUB_SECRET "test-secret"
   ```

3. **Check the values:**
   ```bash
   npx convex env get --prod SITE_URL
   npx convex env get --prod JWT_PRIVATE_KEY
   npx convex env get --prod JWKS
   npx convex env get --prod AUTH_GITHUB_ID
   ```

4. **Deploy:**
   ```bash
   npx convex deploy --cmd 'npm run build'
   ```

## Common Test Scenarios

### Scenario 1: First-time user (no env vars set)

```bash
node dist/bin.cjs --site-url "http://localhost:5173" --skip-git-check
```

**Expected:**
- ✔ Sets SITE_URL
- ✔ Generates and sets JWT_PRIVATE_KEY and JWKS
- ✔ Modifies tsconfig.json (if needed)
- ✔ Creates auth files (if missing)
- ✔ Shows dev success message with prod reminder

### Scenario 2: Running again (env vars already set)

```bash
node dist/bin.cjs --site-url "http://localhost:5173" --skip-git-check
```

**Expected:**
- Asks if you want to change SITE_URL (answer N)
- Asks if you want to overwrite keys (answer N)
- Skips file creation (already exist)
- Fast execution (no prompts if you answer N)

### Scenario 3: Production first-time setup

```bash
node dist/bin.cjs --prod --site-url "https://myapp.com" --skip-git-check
```

**Expected:**
- ✔ Sets SITE_URL on prod
- ✔ Generates and sets JWT_PRIVATE_KEY and JWKS on prod
- ✔ Skips file scaffolding (files from dev already exist)
- ✔ Shows prod success message (no dev reminder)

### Scenario 4: Interactive mode (omit --site-url)

```bash
node dist/bin.cjs --skip-git-check
```

**Expected:**
- Prompts: "Enter the URL of your local web server (e.g. http://localhost:1234)"
- Shows default based on framework (5173 for Vite, 3000 for Next.js)
- Continues with setup after you provide URL

## Debugging

If the CLI fails or behaves unexpectedly:

1. **Check you're in a valid Convex project:**
   ```bash
   ls convex.json  # Should exist
   cat .env.local | grep CONVEX_DEPLOYMENT  # Should be set
   ```

2. **Check deployment connection:**
   ```bash
   npx convex env get CONVEX_SITE_URL  # Should return a URL
   ```

3. **Run with verbose logging:**
   The CLI doesn't have a `--verbose` flag yet, but you can check:
   - What deployment it's targeting (shown in prompts/messages)
   - The `convex env get/set` commands it runs (shown in output)

4. **Check the generated files:**
   ```bash
   cat convex/auth.ts
   cat convex/http.ts
   cat convex/convex.config.ts  # If using components
   ```

## Clean Up After Testing

To reset your test environment:

```bash
# Unset env vars
npx convex env unset SITE_URL
npx convex env unset JWT_PRIVATE_KEY
npx convex env unset JWKS

# Remove generated files (if you want to start fresh)
rm convex/auth.ts convex/http.ts convex/convex.config.ts
```

## CI/Non-Interactive Testing

The CLI detects `process.stdout.isTTY`. In CI:

```bash
# This will fail if SITE_URL is not already set (no TTY to prompt)
node dist/bin.cjs --prod --skip-git-check < /dev/null

# This will work (explicit URL, no prompt needed)
node dist/bin.cjs --prod --site-url "https://myapp.com" --skip-git-check < /dev/null
```
