import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    files: ["convex/**/*.ts"],
    ignores: ["convex/auth/**", "convex/_generated/**", "convex/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/_generated/server", "**/_generated/server.js", "convex/server"],
          importNames: ["query", "mutation", "action", "httpAction", "queryGeneric", "mutationGeneric", "actionGeneric", "httpActionGeneric"],
          message: "Public registrations must use explicit access builders from convex/auth/model.",
        }],
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
