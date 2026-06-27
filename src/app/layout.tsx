import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "Routelapse — Animated Travel Map Route Video Maker";
const description =
  "Turn any trip into a shareable animated map route video for Reels, TikTok, and Shorts. Plot your route, watch the camera fly it, export an MP4 — free, no signup, runs entirely in your browser.";

export const metadata: Metadata = {
  metadataBase: new URL("https://routelapse.com"),
  title: {
    default: title,
    template: "%s | Routelapse",
  },
  description,
  applicationName: "Routelapse",
  keywords: [
    "travel map animation",
    "animated route video",
    "travel route video maker",
    "map animation maker",
    "travel reel maker",
    "route animation for TikTok",
    "travel map video for Reels",
    "mult.dev alternative",
    "animated travel map",
    "trip recap video",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "Routelapse",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Routelapse — animated travel map route video maker",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "technology",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
