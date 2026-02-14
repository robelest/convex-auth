import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isDev = process.argv.includes('dev');
const isCDN = process.env.PORTAL_BUILD_TARGET === 'cdn';
const outputDir = isCDN ? 'build-cdn' : 'build';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: outputDir,
			assets: outputDir,
			fallback: 'index.html',
			precompress: !isDev,
		}),
		paths: {
			// CDN build serves from root (auth.robelest.com/)
			// Self-hosted build nests under /auth to avoid route conflicts
			base: isDev ? '' : (isCDN ? '' : '/auth'),
		},
		alias: {
			'@convex': '../../convex',
			'@convex/*': '../../convex/*',
		},
	},
};

export default config;
