#!/usr/bin/env node

/**
 * Stages the CDN deployment directory for convex-auth.pages.dev.
 *
 * Output structure (cdn-stage/):
 *
 *   /                     ← CDN-hosted portal (base: '')
 *   ├── index.html
 *   ├── _app/...
 *   └── v/
 *       └── {version}/
 *           ├── manifest.json   ← file list + checksums for CLI downloads
 *           └── auth/           ← self-hosted portal build (base: '/auth')
 *               ├── index.html
 *               └── _app/...
 *
 * Usage:  node scripts/build-cdn-deploy.js
 *
 * Expects both portal builds to already exist:
 *   - packages/portal/build/      (self-hosted, base: '/auth')
 *   - packages/portal/build-cdn/  (CDN, base: '')
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = new URL("..", import.meta.url).pathname;
const AUTH_PKG = JSON.parse(readFileSync(join(ROOT, "packages/auth/package.json"), "utf8"));
const VERSION = AUTH_PKG.version;

const SELF_HOSTED_DIR = join(ROOT, "packages/portal/build");
const CDN_DIR = join(ROOT, "packages/portal/build-cdn");
const STAGE_DIR = join(ROOT, "cdn-stage");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all files under `dir`, returning paths relative to `dir`. */
function collectFiles(dir, base = dir) {
	const results = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectFiles(full, base));
		} else {
			results.push(relative(base, full));
		}
	}
	return results;
}

/** SHA-256 hex hash of a file's contents. */
function hashFile(filePath) {
	const content = readFileSync(filePath);
	return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

console.log(`Staging CDN deploy for v${VERSION}...`);

// Clean and create stage directory
mkdirSync(STAGE_DIR, { recursive: true });

// 1. Copy CDN build to stage root (the CDN-hosted portal)
cpSync(CDN_DIR, STAGE_DIR, { recursive: true });
console.log(`  Copied CDN build → cdn-stage/`);

// 2. Copy self-hosted build to stage/v/{version}/auth/
const versionedAuthDir = join(STAGE_DIR, "v", VERSION, "auth");
mkdirSync(versionedAuthDir, { recursive: true });
cpSync(SELF_HOSTED_DIR, versionedAuthDir, { recursive: true });
console.log(`  Copied self-hosted build → cdn-stage/v/${VERSION}/auth/`);

// 3. Generate manifest.json for the versioned self-hosted build
const selfHostedFiles = collectFiles(SELF_HOSTED_DIR);
const manifest = {
	version: VERSION,
	generatedAt: new Date().toISOString(),
	files: selfHostedFiles.map((relPath) => ({
		path: relPath,
		sha256: hashFile(join(SELF_HOSTED_DIR, relPath)),
		size: statSync(join(SELF_HOSTED_DIR, relPath)).size,
	})),
};

const manifestPath = join(STAGE_DIR, "v", VERSION, "manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`  Generated manifest.json (${manifest.files.length} files)`);

console.log(`\nStaging complete → cdn-stage/`);
console.log(`  CDN portal:       cdn-stage/index.html`);
console.log(`  Self-hosted:      cdn-stage/v/${VERSION}/auth/`);
console.log(`  Manifest:         cdn-stage/v/${VERSION}/manifest.json`);
console.log(`\nRun: bunx wrangler pages deploy cdn-stage --project-name convex-auth`);
