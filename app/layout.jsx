import "./globals.css";
import { Toaster } from "sonner";

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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d11" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // let the tab bar sit under the home indicator
};

// Applies the saved theme before first paint. Without this the page renders in
// the OS theme and then snaps to the chosen one — a visible flash on every load.
const THEME_INIT = `try{var t=localStorage.getItem('jobhunt.theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        {children}
        <Toaster richColors closeButton position="top-center" />
      </body>
    </html>
  );
}
