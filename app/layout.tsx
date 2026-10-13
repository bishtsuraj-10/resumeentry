import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talentflow — Resume Intelligence",
  description: "Secure resume processing and candidate data management.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t;try{t=localStorage.getItem("talentflow.theme")}catch(e){}document.documentElement.dataset.theme=t==="light"||t==="dark"?t:window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
