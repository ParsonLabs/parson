import { ArrowRight, FolderOpen, Monitor, Play } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import InteractiveProductDemo from "../components/interactive-product-demo";
import PlatformDownloadButton from "../components/platform-download-button";
import StickyDownloadButton from "../components/sticky-download-button";

export const metadata: Metadata = {
  title: { absolute: "Parson - Your music. Instantly." },
  description:
    "Choose a folder and start listening. Parson is a local-first music server and player for Windows, Android, and the web.",
};

const trustItems = [
  "Self-hosted",
  "Local-first",
  "Open source",
  "No required cloud library upload",
  "Lossless playback",
];

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.36-3.9-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.74-1.55-2.57-.3-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.16 1.18a10.94 10.94 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.24c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <Link href="/" className="landing-wordmark">
            Parson
          </Link>
          <nav aria-label="Main navigation">
            <StickyDownloadButton />
            <Link href="/docs">Docs</Link>
            <a
              className="landing-github-icon"
              href="https://github.com/ParsonLabs/Parson"
              rel="noreferrer"
              target="_blank"
              aria-label="GitHub"
            >
              <GitHubIcon />
            </a>
          </nav>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-glow" />
        <div className="landing-container landing-hero-inner">
          <h1>
            Your music.
            <br />
            Instantly.
          </h1>
          <p>Choose a folder. Start listening.</p>
          <div className="landing-actions" id="hero-download">
            <PlatformDownloadButton />
            <a
              className="landing-text-link"
              href="https://github.com/ParsonLabs/Parson"
              rel="noreferrer"
              target="_blank"
            >
              <GitHubIcon />
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="landing-section landing-proof">
        <div className="landing-wide-container">
          <InteractiveProductDemo />
        </div>
      </section>

      <section className="landing-section landing-screenshots">
        <div className="landing-wide-container">
          <div className="landing-screenshot-copy">
            <h2>Every album gets room to breathe.</h2>
            <span>
              Browse your library, settle into a release, or follow the lyrics
              without leaving your music behind.
            </span>
          </div>
          <div className="landing-screenshot-grid">
            <figure className="landing-screenshot-featured">
              <Image
                src="/screenshots/01-home.png"
                alt="Parson Home showing the Afterlight, Night Swim, Amber Hours, and Evergreen albums"
                width={2880}
                height={1620}
                sizes="(max-width: 900px) 100vw, 67vw"
              />
            </figure>
            <div>
              <figure>
                <Image
                  src="/screenshots/04-album.png"
                  alt="The Amber Hours album and track list in Parson"
                  width={2880}
                  height={1620}
                  sizes="(max-width: 900px) 100vw, 32vw"
                />
              </figure>
              <figure>
                <Image
                  src="/screenshots/07-lyrics.png"
                  alt="Centered synced lyrics for Signal Fires over the Golden State artwork"
                  width={2880}
                  height={1620}
                  sizes="(max-width: 900px) 100vw, 32vw"
                />
              </figure>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-how">
        <div className="landing-container">
          <h2>
            Choose a folder.
            <span className="landing-mobile-break">Press play.</span>
          </h2>
          <div className="landing-steps">
            <article>
              <Monitor />
              <div>
                <h3>Install</h3>
                <p>One app. No server setup.</p>
              </div>
            </article>
            <article>
              <FolderOpen />
              <div>
                <h3>Choose your library</h3>
                <p>Point Parson at your music.</p>
              </div>
            </article>
            <article>
              <Play />
              <div>
                <h3>Listen</h3>
                <p>Windows, Android, or web.</p>
              </div>
            </article>
          </div>
          <div className="landing-trust-strip">
            <div>
              <div>
                <h2>Your music stays yours.</h2>
                <p>{trustItems.join(" - ")}</p>
              </div>
              <Link href="/docs/accounts-privacy-security">
                Privacy and Security <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-final" id="download">
        <div className="landing-container">
          <h2>
            Choose a folder.
            <br />
            Start listening.
          </h2>
          <PlatformDownloadButton />
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-container">
          <span>© ParsonLabs</span>
          <nav>
            <Link href="/docs">Docs</Link>
            <a
              href="https://github.com/ParsonLabs/Parson"
              rel="noreferrer"
              target="_blank"
            >
              GitHub
            </a>
            <Link href="/docs/accounts-privacy-security#privacy">Privacy</Link>
            <Link href="/docs/accounts-privacy-security#security">
              Security
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
