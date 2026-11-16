import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default defineConfig(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"] },
  tseslint.configs.recommended,
  prettier,
);
