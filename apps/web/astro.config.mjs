import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Pages read the dataset at build time; resolved here because page code gets bundled elsewhere.
const dataDir = fileURLToPath(new URL("../../data/", import.meta.url));
const rulesetsDir = fileURLToPath(new URL("../../rulesets/", import.meta.url));

// The Pages deploy workflow sets these from actions/configure-pages, so the same build works
// for <owner>.github.io/legends-of-league and for a custom domain.
export default defineConfig({
  site: process.env.SITE_ORIGIN || "http://localhost:4321",
  // configure-pages reports an empty base path for custom domains.
  base: process.env.SITE_BASE_PATH || "/",
  trailingSlash: "ignore",
  vite: {
    plugins: [tailwindcss()],
    define: {
      "import.meta.env.LOL_DATA_DIR": JSON.stringify(dataDir),
      "import.meta.env.LOL_RULESETS_DIR": JSON.stringify(rulesetsDir),
    },
  },
});
