import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run state retains isolated repository workspaces for recovery and audit.
    // They are data, not this package's tests.
    exclude: [...configDefaults.exclude, "**/.neolit/**"],
  },
});
