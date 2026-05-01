import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import vercel from "@astrojs/vercel";

export default defineConfig({
  integrations: [tailwind({ applyBaseStyles: false })],
  site: "https://sg-long-weekend-optimizer.vercel.app",
  output: "static",
  adapter: vercel(),
});
