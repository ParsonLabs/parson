"use client";

import { useState } from "react";
import { releaseBase, releaseVersion } from "../../lib/release-downloads";
import styles from "./updates.module.css";

export default function Downloads() {
  const [architecture, setArchitecture] = useState({
    windows: "x64",
    mac: "arm64",
    linux: "x64",
  });
  const download = (suffix: string) =>
    `${releaseBase}/Parson_${releaseVersion}_${suffix}`;
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header>
          <a className={styles.brand} href="https://parson.dev">
            <img src="/icons/icon.svg" alt="" />
            Parson
          </a>
          <a className={styles["header-link"]} href="https://parson.dev">
            Back to Parson <span aria-hidden="true">↗</span>
          </a>
        </header>
        <main>
          <div className={styles.release}>
            <span className={styles.badge}>Version {releaseVersion}</span>
          </div>
          <section className={styles.cards} aria-label="Downloads">
            <article
              className={styles.card + " " + styles.primary}
              data-platform="windows"
            >
              <div className={styles.os}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 4l9-1v8H2zm11-1l9-1v9h-9zM2 13h9v8l-9-1zm11 0h9v9l-9-1z" />
                </svg>
              </div>
              <h2>Windows</h2>
              <p className={styles["platform-note"]}>Installer</p>
              <div
                className={styles.switch}
                role="group"
                aria-label="Windows architecture"
              >
                <button
                  className={
                    architecture.windows === "x64" ? styles.selected : undefined
                  }
                  onClick={() =>
                    setArchitecture({ ...architecture, windows: "x64" })
                  }
                  aria-pressed={architecture.windows === "x64"}
                >
                  x64
                </button>
                <button
                  className={
                    architecture.windows === "arm64"
                      ? styles.selected
                      : undefined
                  }
                  onClick={() =>
                    setArchitecture({ ...architecture, windows: "arm64" })
                  }
                  aria-pressed={architecture.windows === "arm64"}
                >
                  ARM64
                </button>
              </div>
              <a
                className={styles.download}
                data-download
                href={download(architecture.windows + "-setup.exe")}
              >
                Download Windows{" "}
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 2v10m-4-4 4 4 4-4M3 12v5h14v-5" />
                </svg>
              </a>
              <a
                className={styles.secondary}
                data-secondary
                href={download(architecture.windows + "-portable.exe")}
              >
                Portable version
              </a>
            </article>
            <article className={styles.card} data-platform="mac">
              <div className={styles.os}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M16.2 2c.2 1.5-.5 3-1.4 3.9-.9.9-2.2 1.5-3.5 1.4-.2-1.4.5-2.9 1.4-3.9.9-.9 2.2-1.5 3.5-1.4zM20 17.1c-.5 1.1-.8 1.7-1.5 2.7-.9 1.3-2.2 2.9-3.8 2.9-1.4 0-1.8-.9-3.6-.9s-2.2.9-3.6.9c-1.6 0-2.8-1.5-3.7-2.8C1.3 16.4.6 11.8 2.5 9c1.3-2 3.4-2.8 5.4-2.8 1.6 0 2.6.9 3.9.9 1.2 0 1.9-.9 3.9-.9 1.7 0 3.5 1 4.6 2.4-4 2.1-3.4 7.5-.3 8.5z" />
                </svg>
              </div>
              <h2>macOS</h2>
              <p className={styles["platform-note"]}>macOS 13 or later</p>
              <div
                className={styles.switch}
                role="group"
                aria-label="Mac architecture"
              >
                <button
                  className={
                    architecture.mac === "arm64" ? styles.selected : undefined
                  }
                  onClick={() =>
                    setArchitecture({ ...architecture, mac: "arm64" })
                  }
                  aria-pressed={architecture.mac === "arm64"}
                >
                  Apple Silicon
                </button>
                <button
                  className={
                    architecture.mac === "x64" ? styles.selected : undefined
                  }
                  onClick={() =>
                    setArchitecture({ ...architecture, mac: "x64" })
                  }
                  aria-pressed={architecture.mac === "x64"}
                >
                  Intel
                </button>
              </div>
              <a
                className={styles.download}
                data-download
                href={download(architecture.mac + ".dmg")}
              >
                Download macOS{" "}
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 2v10m-4-4 4 4 4-4M3 12v5h14v-5" />
                </svg>
              </a>
              <a
                className={styles.secondary}
                data-secondary
                href={download(architecture.mac + ".zip")}
              >
                ZIP version
              </a>
            </article>
            <article className={styles.card} data-platform="linux">
              <div className={styles.os}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2a5 5 0 0 0-5 5v3c0 2-2 4-2 6 0 3 3 5 7 5s7-2 7-5c0-2-2-4-2-6V7a5 5 0 0 0-5-5zm-2 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-5 4 3-2 3 2-3 2zm3 4c2 0 4 2 4 4H8c0-2 2-4 4-4z" />
                </svg>
              </div>
              <h2>Linux</h2>
              <p className={styles["platform-note"]}>AppImage</p>
              <div
                className={styles.switch}
                role="group"
                aria-label="Linux architecture"
              >
                <button
                  className={
                    architecture.linux === "x64" ? styles.selected : undefined
                  }
                  onClick={() =>
                    setArchitecture({ ...architecture, linux: "x64" })
                  }
                  aria-pressed={architecture.linux === "x64"}
                >
                  x64
                </button>
                <button
                  className={
                    architecture.linux === "arm64" ? styles.selected : undefined
                  }
                  onClick={() =>
                    setArchitecture({ ...architecture, linux: "arm64" })
                  }
                  aria-pressed={architecture.linux === "arm64"}
                >
                  ARM64
                </button>
              </div>
              <a
                className={styles.download}
                data-download
                href={download(
                  (architecture.linux === "x64" ? "x86_64" : "arm64") +
                    ".AppImage",
                )}
              >
                Download Linux{" "}
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 2v10m-4-4 4 4 4-4M3 12v5h14v-5" />
                </svg>
              </a>
              <a
                className={styles.secondary}
                data-secondary
                href={download(
                  (architecture.linux === "x64" ? "amd64" : "arm64") + ".deb",
                )}
              >
                Debian package
              </a>
            </article>
          </section>
        </main>
        <footer>
          <span>Parson · Your music. Instantly.</span>
          <div className={styles["footer-links"]}>
            <a href="https://parson.dev/docs">Documentation</a>
            <a href="https://github.com/ParsonLabs/parson">GitHub</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
