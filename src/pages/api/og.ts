import type { APIRoute } from "astro";
import { ImageResponse } from "@vercel/og";

export const prerender = false;

export const GET: APIRoute = () => {
  return new ImageResponse(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background: "linear-gradient(135deg, #f0fdf4 0%, #ffffff 60%)",
          fontFamily: "system-ui, sans-serif",
        },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", gap: "16px" },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "32px",
                      color: "#16a34a",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                    },
                    children: "🇸🇬 SG Long-Weekend Optimizer",
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "72px",
                      fontWeight: 800,
                      color: "#111827",
                      lineHeight: 1.1,
                      letterSpacing: "-0.04em",
                    },
                    children:
                      "Turn 14 leave days into 37 days off.",
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "28px",
                      color: "#4b5563",
                      marginTop: "16px",
                    },
                    children:
                      "Optimal leave-taking strategies around Singapore public holidays.",
                  },
                },
              ],
            },
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "22px",
                color: "#6b7280",
              },
              children: [
                {
                  type: "div",
                  props: {
                    children: "sg-long-weekend-optimizer.vercel.app",
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      gap: "12px",
                      alignItems: "center",
                    },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: {
                            background: "#dc2626",
                            width: "20px",
                            height: "20px",
                            borderRadius: "4px",
                          },
                          children: "",
                        },
                      },
                      { type: "div", props: { children: "PH" } },
                      {
                        type: "div",
                        props: {
                          style: {
                            background: "#16a34a",
                            width: "20px",
                            height: "20px",
                            borderRadius: "4px",
                            marginLeft: "16px",
                          },
                          children: "",
                        },
                      },
                      { type: "div", props: { children: "Leave" } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
    },
  );
};
