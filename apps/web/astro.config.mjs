import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// The Pages deploy workflow sets these from actions/configure-pages, so the same build works
// for <owner>.github.io/legends-of-league and for a custom domain.
export default defineConfig({
  site: process.env.SITE_ORIGIN || "http://localhost:4321",
  // configure-pages reports an empty base path for custom domains.
  base: process.env.SITE_BASE_PATH || "/",
  trailingSlash: "ignore",
  vite: {
    plugins: [tailwindcss()],
  },
});
