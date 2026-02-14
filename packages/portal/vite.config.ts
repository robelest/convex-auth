import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Inject the auth package version at build time as a global constant.
// The portal uses this for runtime version compatibility checks.
const authPkg = JSON.parse(readFileSync('../auth/package.json', 'utf-8'));

export default defineConfig({
	define: {
		__PORTAL_VERSION__: JSON.stringify(authPkg.version),
	},
	plugins: [tailwindcss(), sveltekit()],
	resolve: {
		alias: {
			// Resolve the workspace auth package directly so Vite's SSR
			// bundler can find the client export from the built dist.
			'@robelest/convex-auth/client': resolve(__dirname, '../auth/dist/client/index.js'),
		},
	},
	server: {
		fs: {
			allow: ['../../convex'],
		},
	},
});
