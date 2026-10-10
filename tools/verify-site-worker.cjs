const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const site = path.resolve(__dirname, "../apps/site");
const routes = [
  "/",
  "/docs",
  "/docs/download-and-install",
  "/showcase",
  "/updates",
];

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const worker = spawn(
    process.execPath,
    [
      require.resolve("wrangler"),
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: site,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  let startupError;
  worker.on("error", (error) => {
    startupError = error;
  });
  for (const stream of [worker.stdout, worker.stderr]) {
    stream.on("data", (data) => {
      logs = (logs + data).slice(-12000);
    });
  }
  try {
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (worker.exitCode !== null)
        throw new Error(`Worker exited with ${worker.exitCode}`);
      try {
        await fetch(origin, { signal: AbortSignal.timeout(2000) });
        ready = true;
        break;
      } catch {
        await delay(300);
      }
    }
    assert.ok(ready, "Worker did not start within 60 seconds");
    for (const route of routes) {
      const response = await fetch(origin + route, {
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(
        response.status,
        200,
        `${route} returned ${response.status}`,
      );
      assert.match(await response.text(), /Parson/);
      console.log(`Worker verified: ${route}`);
    }
    const search = await fetch(`${origin}/api/search?query=music`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(search.status, 200, "Documentation search failed");
    await search.json();
    console.log("Worker verified: documentation search");
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    if (worker.pid && worker.exitCode === null) {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/pid", String(worker.pid), "/t", "/f"], {
          stdio: "ignore",
        });
      } else {
        process.kill(-worker.pid, "SIGTERM");
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
