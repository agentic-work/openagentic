import { defineConfig } from "vitest/config";

export default defineConfig({
  // Transform .tsx with the automatic JSX runtime so screens don't need an
  // explicit React-in-scope import (mirrors tsconfig "jsx": "react-jsx").
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
