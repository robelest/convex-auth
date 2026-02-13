// Convex makes process.env available at runtime for environment variables.
// This ambient declaration provides TypeScript type information.
declare const process: { env: Record<string, string | undefined> };
