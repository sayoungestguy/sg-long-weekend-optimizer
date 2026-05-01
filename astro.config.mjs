import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import vercel from "@astrojs/vercel/serverless";

export default defineConfig({
  integrations: [tailwind({ applyBaseStyles: false })],
  site: "https://sg-long-weekend-optimizer.vercel.app",
  output: "hybrid",
  adapter: vercel(),
});
