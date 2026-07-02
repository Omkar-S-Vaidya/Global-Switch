import "./globals.css";

export const metadata = {
  title: {
    default: "JobHunt — Live Tech Jobs, Matched to Your Resume",
    template: "%s · JobHunt",
  },
  description:
    "Discover live software-engineering roles across 9 countries, match them to your resume and skills, and track every application — applied, interview, offer — in one place.",
  applicationName: "JobHunt",
  keywords: ["tech jobs", "software engineer jobs", "resume match", "job tracker", "Greenhouse jobs"],
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
};

export const viewport = {
  themeColor: "#4f6ef7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
