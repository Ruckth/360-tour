import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import architecture from "./scripts/eslint-architecture.mjs";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**", ".output/**", ".nitro/**", ".tanstack/**", "dist/**",
      "src/start-app/routeTree.gen.ts",
      "node_modules/**",
      "opensrc/**",
      ".claude/**",
      ".cursor/**",
      ".vercel/**",
      "archive/**",
      "convex/_generated/**",
      "src/components/reui/**", // vendored ReUI registry code
      "build/**",
      "output/**", // local evaluation logs, recordings, and generated reports
      ".local-dev/**", // private checkout-local backend/home; source stays in convex/
    ],
  },
  {
    files: ["{src,convex}/**/*.{ts,tsx,js,mjs,cjs,mts,cts,jsx}"],
    plugins: { architecture },
    rules: { "architecture/ownership": "error" },
  },
  {
    files: ["convex/**/*.{ts,tsx,js,mjs,cjs,mts,cts,jsx}"],
    ignores: ["convex/auth/model.ts", "convex/**/*.test.*"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/_generated/server", "**/_generated/server.*", "convex/server"],
          importNames: ["query", "mutation", "action", "httpAction", "queryGeneric", "mutationGeneric", "actionGeneric", "httpActionGeneric"],
          message: "Only convex/auth/model.ts owns raw public builders; use its explicit access builders.",
        }],
      }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx,js,mjs,cjs,mts,cts,jsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["convex/lib/**", "convex/*/model", "convex/*/model.*", "convex/*/private/**"], message: "Use convex/shared rules or generated API/data types in browser code." }],
      }],
    },
  },
  {
    // Same files eslint-config-next registers the react-hooks plugin for.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/immutability": "error",
    },
  },
];

export default config;
