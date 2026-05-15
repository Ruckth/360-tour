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
      "convex/_generated/**",
      "src/**/*.svelte",
      ".svelte-kit/**",
      "build/**",
    ],
  },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
    },
  },
];

export default config;
