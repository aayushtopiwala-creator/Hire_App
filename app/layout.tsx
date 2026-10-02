import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { currentArjun } from "@/lib/auth";
import { env } from "@/lib/env";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz", "SOFT"] });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Kargo Hiring Desk",
  description: "Ranked PM / SPM shortlist for the founder's review.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Signed-out visitors (the sign-in page) see neither the navigation nor the test-recipient address.
  const user = await currentArjun();
  const testRecipient = user ? env.emailTestRecipient() : null;
  return (
    <html lang="en" className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <Link href="/" className="wordmark">
              Kargo <span>Hiring desk</span>
            </Link>
            {user && (
              <>
                <nav>
                  <Link href="/review">Review &amp; send</Link>
                  <Link href="/">Shortlist</Link>
                  <Link href="/upload">Upload CVs</Link>
                  <Link href="/audit">AI audit log</Link>
                </nav>
                <form action="/auth/signout" method="post" className="signout">
                  <span className="mono">{user}</span>
                  <button type="submit">Sign out</button>
                </form>
              </>
            )}
          </div>
        </header>
        {user && !testRecipient && !env.allowRealSends() && (
          <div className="test-mode">
            <div className="page">
              Sending is disabled — EMAIL_TEST_RECIPIENT isn’t set on this deployment. Confirm &amp; Send will refuse until it is.
            </div>
          </div>
        )}
        {testRecipient && (
          <div className="test-mode">
            <div className="page">
              Test mode — every confirmed send is redirected to <span className="mono">{testRecipient}</span>. Remove
              EMAIL_TEST_RECIPIENT to send to candidates.
            </div>
          </div>
        )}
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
