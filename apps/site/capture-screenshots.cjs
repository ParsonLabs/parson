const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.PARSON_SCREENSHOT_URL ?? "http://127.0.0.1:3010";
const appDirectory = __dirname;
const workspace = path.resolve(appDirectory, "../..");
const outputDirectory = path.join(appDirectory, "public/screenshots");

const shots = [
  {
    album: "afterlight",
    file: "01-home.png",
    time: 42,
    title: "Home",
    track: 0,
    view: "home",
  },
  {
    album: "night-swim",
    file: "02-library.png",
    time: 68,
    title: "Library",
    track: 1,
    view: "library",
  },
  {
    album: "evergreen",
    file: "03-artist.png",
    time: 91,
    title: "Artist",
    track: 2,
    view: "artist",
  },
  {
    album: "amber-hours",
    file: "04-album.png",
    time: 127,
    title: "Album",
    track: 3,
    view: "album",
  },
  {
    album: "still-form",
    file: "05-search.png",
    time: 153,
    title: "Search",
    track: 4,
    query: "Mira",
    view: "home",
  },
  {
    album: "red-shift",
    file: "06-now-playing.png",
    playing: true,
    time: 37,
    title: "Now playing",
    track: 5,
    view: "home",
  },
  {
    album: "golden-state",
    file: "07-lyrics.png",
    time: 114,
    title: "Lyrics",
    track: 7,
    panel: "lyrics",
    view: "home",
  },
];

const requestedFile = process.env.PARSON_SCREENSHOT_FILE;
const selectedShots = requestedFile
  ? shots.filter((shot) => shot.file === requestedFile)
  : shots;

if (selectedShots.length === 0) {
  throw new Error(`Unknown screenshot file: ${requestedFile}`);
}

async function serverIsReady() {
  try {
    const response = await fetch(`${baseUrl}/showcase`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverIsReady()) return null;
  const child = spawn(
    "bun",
    [
      "--filter",
      "parson-site",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3010",
    ],
    { cwd: workspace, stdio: "inherit" },
  );
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await serverIsReady()) return child;
  }
  child.kill("SIGTERM");
  throw new Error("Timed out waiting for the Parson showcase route");
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map(
        (image) =>
          image.complete ||
          new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          }),
      ),
    );
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.waitForTimeout(700);
}

async function main() {
  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    await fs.mkdir(outputDirectory, { recursive: true });
    for (const shot of selectedShots) {
      const context = await browser.newContext({
        colorScheme: "dark",
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
        viewport: { width: 1440, height: 810 },
      });
      const page = await context.newPage();
      const parameters = new URLSearchParams({
        album: shot.album,
        time: String(shot.time),
        track: String(shot.track),
        view: shot.view,
      });
      if (shot.playing) parameters.set("playing", "true");
      if (shot.panel) parameters.set("panel", shot.panel);
      if (shot.query) parameters.set("query", shot.query);
      await page.goto(`${baseUrl}/showcase?${parameters}`, {
        waitUntil: "networkidle",
      });
      await page.addStyleTag({
        content:
          "nextjs-portal,.demo-window-controls{display:none!important}*,*::before,*::after{animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important;transition:none!important}",
      });
      await settle(page);
      // Warm the compositor to avoid stale blurred tiles.
      await page.screenshot({ animations: "disabled" });
      await page.waitForTimeout(350);
      await page.screenshot({
        animations: "disabled",
        path: path.join(outputDirectory, shot.file),
      });
      process.stdout.write(`Captured ${shot.title}: ${shot.file}\n`);
      await context.close();
    }
  } finally {
    await browser.close();
    server?.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
