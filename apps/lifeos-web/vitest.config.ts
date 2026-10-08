import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// T033: web-unit + UI-fixture. happy-dom (Node 22.19-yhteensopiva, toisin
// kuin uusin jsdom) + testing-library. globals pois päältä — eksplisiittiset
// importit vitestistä jotta raja pysyy näkyvänä.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@lifeos/capabilities": path.resolve(
        import.meta.dirname,
        "../../packages/capabilities/src/index.ts",
      ),
      "@lifeos/domain": path.resolve(import.meta.dirname, "../../packages/domain/src/index.ts"),
      "@lifeos/data": path.resolve(import.meta.dirname, "../../packages/data/src/index.ts"),
      "@lifeos/ui": path.resolve(import.meta.dirname, "../../packages/ui/src/index.ts"),
      "@lifeos/config": path.resolve(import.meta.dirname, "../../packages/config/src/index.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
