// @ts-check
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";

const githubPagesUrl = "https://gamrix.github.io";

const site = process.env.VERCEL
  ? process.env.VERCEL_ENV === "production"
    ? "https://astro-shadcn-ui-template.vercel.app"
    : `https://${process.env.VERCEL_URL}`
  : (process.env.SITE || githubPagesUrl);
const base = process.env.BASE || "/";

// https://astro.build/config
export default defineConfig({
  site,
  base,
  integrations: [react()],
  experimental: {
    fonts: [
      {
        provider: fontProviders.google(),
        name: "Inter",
        cssVariable: "--font-inter",
      },
    ],
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ["@js-temporal/polyfill"],
    },
  },
});
