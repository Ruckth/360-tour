import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import architecture from "./scripts/eslint-architecture.mjs";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**",
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
    ],
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.eslint.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
  {
    files: ["{src,convex}/**/*.{ts,tsx,js,mjs}"],
    plugins: { architecture },
    rules: { "architecture/ownership": "error" },
  },
  {
    files: ["convex/**/*.{ts,tsx,js,mjs}"],
    ignores: ["convex/auth/model.ts", "convex/**/*.test.*", "convex/testing/**"],
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
    files: ["src/**/*.{ts,tsx,js,mjs}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["convex/lib/**", "convex/*/model", "convex/*/model.*", "convex/*/private/**"], message: "Use convex/shared rules or generated API/data types in browser code." }],
      }],
    },
  },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
    },
  },
];

export default config;
