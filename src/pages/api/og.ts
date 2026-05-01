import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  return new Response(
    "OG image generation not yet implemented. Wire up @vercel/og or satori here.",
    { status: 501, headers: { "content-type": "text/plain" } },
  );
};
