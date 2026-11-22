// The React/TypeScript lint base formerly supplied by eslint-config-next (core-web-vitals +
// typescript), rebuilt from the same plugins without Next: the plugin rule sets and overrides are
// unchanged, JavaScript uses ESLint's own parser instead of Next's bundled Babel parser, and the
// framework-neutral @next/next checks are kept as named local rules. The remaining @next/next rules target
// next/font, next/script, next/head, pages/_document and Next routing, which Start never loads.
// Each neutral check is its own react-app/* rule below.
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** @param {any} node JSXOpeningElement @param {string} name */
const isElement = (node, name) => node.name.type === "JSXIdentifier" && node.name.name === name;
/** @param {any} node JSXOpeningElement @param {string} name */
const attribute = (node, name) => node.attributes.find((item) => item.type === "JSXAttribute" && item.name.name === name);
/** @param {string} message @param {(context: any) => object} create */
const rule = (message, create) => ({ meta: { type: "problem", schema: [], messages: { violation: message } }, create });

/**
 * The framework-neutral checks formerly enforced by @next/next (no-img-element, no-css-tags,
 * no-sync-scripts, no-unwanted-polyfillio, no-assign-module-variable), one named rule each so an
 * exemption names exactly one check. tests/unit/eslint-guardrails.test.ts covers every rule.
 */
export const reactAppPlugin = {
  rules: {
    "no-raw-img": rule("Use Image from @/platform/image (optimized, responsive). A raw <img> needs a justified exemption.", (context) => ({
      JSXOpeningElement(node) { if (isElement(node, "img")) context.report({ node, messageId: "violation" }); },
    })),
    "no-stylesheet-link": rule("Import stylesheets instead of adding a <link rel=\"stylesheet\">.", (context) => ({
      JSXOpeningElement(node) {
        if (isElement(node, "link") && attribute(node, "rel")?.value?.value === "stylesheet") context.report({ node, messageId: "violation" });
      },
    })),
    "no-sync-scripts": rule("External scripts must be async or defer.", (context) => ({
      JSXOpeningElement(node) {
        if (isElement(node, "script") && attribute(node, "src") && !attribute(node, "async") && !attribute(node, "defer")) context.report({ node, messageId: "violation" });
      },
    })),
    "no-polyfill-io": rule("Do not load polyfill.io; the browser targets need no polyfill service.", (context) => ({
      JSXAttribute(node) {
        const value = node.value?.type === "JSXExpressionContainer" ? node.value.expression : node.value;
        if (node.name.name === "src" && typeof value?.value === "string" && /polyfill\.io/.test(value.value)) context.report({ node, messageId: "violation" });
      },
    })),
    "no-module-variable": rule("Do not declare a variable named module.", (context) => ({
      VariableDeclarator(node) { if (node.id.type === "Identifier" && node.id.name === "module") context.report({ node, messageId: "violation" }); },
    })),
  },
};

const reactAppConfig = [
  {
    name: "react-app",
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    plugins: { react, "react-hooks": reactHooks, import: importPlugin, "jsx-a11y": jsxA11y, "react-app": reactAppPlugin },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...Object.fromEntries(Object.keys(reactAppPlugin.rules).map((name) => [`react-app/${name}`, "error"])),
      "import/no-anonymous-default-export": "warn",
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "react/jsx-no-target-blank": "off",
    },
  },
  {
    name: "react-app/typescript",
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: "module" } },
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
];

export default reactAppConfig;
