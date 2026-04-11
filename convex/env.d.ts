// Convex provides process.env for environment variables in all runtimes
declare const process: {
  env: Record<string, string | undefined>;
};
