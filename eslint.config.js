import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { createNodeResolver, importX } from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import boundaries from "eslint-plugin-boundaries";
import tailwindcss from "eslint-plugin-tailwindcss";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import { readFileSync } from "node:fs";

// The engine's file set is declared once, in a manifest the extraction will also
// read. Duplicating it here as a literal list would let the boundary that is
// enforced and the boundary that moves drift apart, which is the drift nobody
// notices until the move. `server/gjc-engine-manifest.test.ts` keeps the
// manifest honest against the tree.
const gjcEngineManifest = JSON.parse(
  readFileSync(new URL("./server/gjc-engine-manifest.json", import.meta.url), "utf8"),
);

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "public/**"],
  },
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      react,
      "react-hooks": reactHooks, // for following React rules such as dependencies in hooks, keys in lists, etc.
      "react-refresh": reactRefresh, // for Vite HMR compatibility
      "import-x": importX, // for import order/sorting. It also detercts circular dependencies and duplicate imports.
      tailwindcss, // for detecting invalid Tailwind classnames and enforcing classname order
      "unused-imports": unusedImports, // for detecting unused imports
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
      // eslint-plugin-tailwindcss v4 resolves utilities from the CSS-first
      // entry point (there is no tailwind.config.js anymore).
      tailwindcss: { cssConfigPath: "./src/index.css" },
    },
    rules: {
      // --- Unused imports/vars ---
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",

      // --- React ---
      "react/jsx-key": "error",
      "react/jsx-no-duplicate-props": "error",
      "react/jsx-no-undef": "error",
      "react/no-children-prop": "error",
      "react/no-danger-with-children": "error",
      "react/no-direct-mutation-state": "error",
      "react/no-unknown-property": "error",
      "react/react-in-jsx-scope": "off",

      // --- React Hooks ---
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // --- React Refresh (Vite HMR) ---
      "react-refresh/only-export-components": "off",

      // --- Import ordering & hygiene ---
      "import-x/no-duplicates": "error",
      "import-x/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always",
        },
      ],
      "import-x/no-cycle": "error",

      // --- Tailwind CSS ---
      "tailwindcss/classnames-order": "error",
      "tailwindcss/no-contradicting-classname": "error",
      "tailwindcss/no-unnecessary-arbitrary-value": "error",

      // --- Disabled base rules ---
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-case-declarations": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
    },
  },
  {
    files: ["server/**/*.{js,ts}"], // apply this block only to backend source files
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    ignores: ["server/**/*.d.ts"], // skip generated declaration files in backend linting
    plugins: {
      boundaries, // enforce backend architecture boundaries (module-to-module contracts)
      "import-x": importX, // keep import hygiene rules (duplicates, unresolved paths, etc.)
      "unused-imports": unusedImports, // remove dead imports/variables from backend files
    },
    languageOptions: {
      parser: tseslint.parser, // parse both JS and TS syntax in backend files
      parserOptions: {
        ecmaVersion: "latest", // support modern ECMAScript syntax in backend code
        sourceType: "module", // treat backend files as ESM modules
      },
      globals: {
        ...globals.node, // expose Node.js globals such as process, Buffer, and __dirname equivalents
      },
    },
    settings: {
      "boundaries/include": ["server/**/*.{js,ts}"], // only analyze dependency boundaries inside backend files
      "import/resolver": {
        // boundaries resolves imports through eslint-module-utils, which reads the classic
        // import/resolver setting instead of import-x/resolver-next.
        typescript: {
          project: ["server/tsconfig.json"], // resolve backend aliases using the canonical backend tsconfig
          alwaysTryTypes: true, // keep normal TS package/type resolution working alongside aliases
        },
        node: {
          extensions: [".mjs", ".cjs", ".js", ".json", ".node", ".ts", ".tsx"], // preserve Node-style fallback resolution for plain files
        },
      },
      "import-x/resolver-next": [
        // ESLint's import plugin does not read tsconfig path aliases on its own.
        // This resolver teaches import-x how to understand the backend-only "@/*"
        // mapping defined in server/tsconfig.json, which fixes false no-unresolved errors in editors.
        createTypeScriptImportResolver({
          project: ["server/tsconfig.json"], // point the resolver at the canonical backend tsconfig instead of the frontend one
          alwaysTryTypes: true, // keep standard TypeScript package resolution working while backend aliases are enabled
        }),
        // Keep Node-style resolution available for normal package imports and plain relative JS files.
        // The TypeScript resolver handles aliases, while the Node resolver preserves the expected fallback behavior.
        createNodeResolver({
          extensions: [".mjs", ".cjs", ".js", ".json", ".node", ".ts", ".tsx"],
        }),
      ],
      "boundaries/elements": [
        {
          // The GJC engine: the worker process, its SDK adapter, its tool policy
          // and the protocol between them. Every file here is original to this
          // project and imports nothing from the app around it, which is what
          // makes it separable from the AGPL shell. The rule below keeps it that
          // way, because the property is easy to lose and expensive to rebuild.
          //
          // `gjc-worker-client.ts` is deliberately absent: it is the app's end of
          // the protocol and runs in the app's process.
          // The engine's published surface. Everything outside the engine reaches
          // it here or not at all, so this file is the whole importable contract
          // that has to survive the engine moving to its own repository.
          type: "gjc-engine-api",
          pattern: ["server/gjc-engine.ts"],
          mode: "file",
        },
        {
          // The application's end of the worker protocol. It runs in the
          // application's process and may use application services, which is why
          // it is not part of the engine - but it is still on the far side of the
          // published surface and must go through it like everything else.
          type: "gjc-engine-client",
          pattern: ["server/gjc-worker-client.ts"],
          mode: "file",
        },
        {
          type: "gjc-engine",
          pattern: gjcEngineManifest.engine,
          mode: "file",
        },
        {
          type: "backend-shared-type-contract", // shared backend type/interface contracts that modules may consume without creating runtime coupling
          pattern: [
            "server/shared/types.{js,ts}",
            "server/shared/interfaces.{js,ts}",
          ], // keep backend modules on explicit shared contract files for erased imports only
          mode: "file", // treat each shared contract file itself as the boundary element instead of the whole folder
        },
        {
          type: "backend-shared-utils", // shared backend runtime helpers that modules may import directly
          pattern: [
            "server/shared/utils.{js,ts}",
            "server/shared/frontmatter.ts",
            "server/shared/claude-cli-path.ts",
            "server/shared/image-attachments.ts",
            "server/shared/tool-output-transport.ts",
            "server/shared/request-origin.ts",
            "server/middleware/desktop-auth.js",
            "server/middleware/auth.js",
          ], // classify shared utility files so modules can depend on them explicitly
          mode: "file",
        },
        {
          type: "backend-legacy-runtime", // legacy runtime persistence modules used while providers migrate into server/modules
          pattern: [
            "server/projects.js",
            "server/utils/runtime-paths.js",
          ], // provider history loading still resolves session data through these legacy runtime files
          mode: "file",
        },
        {
          type: "backend-module", // logical element name used by boundaries rules below
          pattern: "server/modules/*", // each direct folder in server/modules is treated as one module boundary
          mode: "folder", // classify dependencies at folder-module level (not per individual file)
          capture: ["moduleName"], // capture the module folder name for messages/debugging/template use
        },
      ],
    },
    rules: {
      // --- Unused imports/vars (backend) ---
      "unused-imports/no-unused-imports": "error", // fail when imports are not used
      "unused-imports/no-unused-vars": "off", // keep backend signal focused on dead imports instead of local unused variables
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",

      // --- Import hygiene (backend) ---
      "import-x/no-duplicates": "error", // prevent duplicate import lines from the same module
      "import-x/order": [
        "error", // keep backend import grouping/order consistent with the frontend config
        {
          groups: [
            "builtin", // Node built-ins such as fs, path, and url come first
            "external", // third-party packages come after built-ins
            "internal", // aliased internal imports such as @/... come next
            "parent", // ../ imports come after aliased internal imports
            "sibling", // ./foo imports come after parent imports
            "index", // bare ./ imports stay last
          ],
          "newlines-between": "always", // require a blank line between import groups in backend files too
        },
      ],
      "import-x/no-cycle": "error",
      "import-x/no-unresolved": "error", // fail when an import path cannot be resolved
      "import-x/no-useless-path-segments": "error", // prefer cleaner paths (remove redundant ./ and ../ segments)
      "import-x/no-absolute-path": "error", // disallow absolute filesystem imports in backend files

      // --- General safety/style (backend) ---
      eqeqeq: ["error", "always", { null: "ignore" }], // avoid accidental coercion while still allowing x == null checks

      // --- Architecture boundaries (backend modules) ---
      "boundaries/dependencies": [
        "error", // treat architecture violations as lint errors
        {
          default: "allow", // allow normal imports unless a rule below explicitly disallows them
          checkInternals: false, // do not apply these cross-module rules to imports inside the same module
          rules: [
            {
              from: { type: "backend-module" }, // modules may depend on shared type/interface contracts only as erased type-only imports
              to: { type: "backend-shared-type-contract" },
              disallow: {
                dependency: { kind: ["value", "typeof"] },
              }, // block runtime imports so shared contracts stay compile-time only instead of becoming hidden shared modules
              message:
                "Backend modules may only use `import type` when importing from server/shared/types.ts or server/shared/interfaces.ts.",
            },
            {
              to: { type: "backend-module" }, // when importing anything that belongs to another backend module
              disallow: { to: { internalPath: "**" } }, // block all direct/deep imports into module internals by default
              message:
                "Cross-module imports must go through that module's barrel file (server/modules/<module>/index.ts or index.js).", // explicit error message for architecture violations
            },
            {
              to: { type: "backend-module" }, // same target scope as the disallow rule above
              allow: {
                to: {
                  internalPath: [
                    "index", // allow extensionless barrel imports resolved as module root index
                    "index.{js,mjs,cjs,ts,tsx}", // allow explicit index.* barrel file imports
                  ],
                },
              }, // re-allow only public module entry points (barrel files)
            },
            {
              // Last, because boundaries lets a later rule re-allow what an
              // earlier one denied: the barrel allowance directly above would
              // otherwise let the engine import any module through its index.
              //
              // The engine is separable from the AGPL shell only while it depends
              // on nothing in it. That is true today by construction, not by
              // accident of what nobody has needed yet, and one convenient import
              // would end it silently. The app may call into the engine; the
              // engine may not reach back - through a barrel or otherwise.
              from: { type: "gjc-engine" },
              disallow: { to: { type: ["backend-module", "backend-legacy-runtime"] } },
              message:
                "The GJC engine may not import the app around it, barrel included. Move the shared piece next to the engine, or pass it through server/gjc-worker-protocol.ts.",
            },
            {
              // Reaching past `gjc-engine.ts` makes every internal symbol look
              // like part of the interface, which is the state this replaced:
              // four modules imported by path, and nobody able to say what moving
              // the engine would break.
              from: { type: ["backend-module", "gjc-engine-client"] },
              disallow: { to: { type: "gjc-engine" } },
              message:
                "Import the engine through server/gjc-engine.ts. Its exports are the published surface; if what you need is missing, export it there deliberately.",
            },
          ],
        },
      ],
      "boundaries/no-unknown": "error", // fail fast if boundaries cannot classify a dependency, which prevents silent rule bypasses
    },
  },
  {
    files: [
      "shared/**/*.{js,cjs,mjs,ts}",
      "scripts/**/*.{js,cjs,mjs,ts}",
      "vite.config.js",
    ],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      "import-x": importX,
      "unused-imports": unusedImports,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-control-regex": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "import-x/no-duplicates": "error",
      "import-x/no-cycle": "error",
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
        },
      ],
    },
  },
);
