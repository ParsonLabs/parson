const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionParts(version) {
  if (!stableVersionPattern.test(version)) {
    throw new Error("Use a stable version, such as 1.0.1.");
  }

  const parts = version.split(".").map(Number);
  const [major, minor, patch] = parts;
  if (major > 2000 || minor > 999 || patch > 999) {
    throw new Error("Version exceeds the mobile build-number range.");
  }

  return parts;
}

function buildNumber(version) {
  const [major, minor, patch] = versionParts(version);
  return major * 1_000_000 + minor * 1_000 + patch;
}

function versionFiles(directory, version) {
  const mobileBuildNumber = buildNumber(version);
  const changes = new Map();

  function updateJson(file, update) {
    const contents = fs.readFileSync(path.join(directory, file), "utf8");
    const document = JSON.parse(contents);
    update(document);
    changes.set(file, `${JSON.stringify(document, null, 2)}\n`);
  }

  function updatePackage(file) {
    updateJson(file, (document) => {
      document.version = version;
    });
  }

  updatePackage("package.json");
  for (const parent of ["apps", "packages"]) {
    const entries = fs.readdirSync(path.join(directory, parent), {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const file = `${parent}/${entry.name}/package.json`;
      if (entry.isDirectory() && fs.existsSync(path.join(directory, file))) {
        updatePackage(file);
      }
    }
  }

  updateJson("apps/mobile/app.json", (document) => {
    document.expo.version = version;
    document.expo.ios.buildNumber = String(mobileBuildNumber);
  });

  const crateNames = new Set();
  const crates = fs.readdirSync(path.join(directory, "crates"), {
    withFileTypes: true,
  });

  for (const crate of crates) {
    const file = `crates/${crate.name}/Cargo.toml`;
    if (!crate.isDirectory() || !fs.existsSync(path.join(directory, file))) {
      continue;
    }

    const contents = fs.readFileSync(path.join(directory, file), "utf8");
    const packageSection = contents.match(/\[package\]([\s\S]*?)(?=\n\[|$)/);
    if (!packageSection) {
      continue;
    }

    const crateName = packageSection[1].match(/^name\s*=\s*"([^"]+)"/m)[1];
    const updatedSection = replaceRustVersion(packageSection[0], version);
    crateNames.add(crateName);
    changes.set(file, contents.replace(packageSection[0], updatedSection));
  }

  const lockPath = path.join(directory, "Cargo.lock");
  if (fs.existsSync(lockPath)) {
    const contents = fs.readFileSync(lockPath, "utf8");
    const updatedLock = contents.replace(
      /\[\[package\]\]([\s\S]*?)(?=\n\[\[package\]\]|$)/g,
      (packageSection) => {
        const crateName = packageSection.match(/^name = "([^"]+)"/m)?.[1];
        if (!crateNames.has(crateName)) {
          return packageSection;
        }
        return replaceRustVersion(packageSection, version);
      },
    );
    changes.set("Cargo.lock", updatedLock);
  }

  return changes;
}

function replaceRustVersion(packageSection, version) {
  return packageSection.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${version}"`,
  );
}

function checkVersions(directory, version) {
  for (const [file, expected] of versionFiles(directory, version)) {
    const actual = fs.readFileSync(path.join(directory, file), "utf8");
    const matches = file.endsWith(".json")
      ? JSON.stringify(JSON.parse(actual)) ===
        JSON.stringify(JSON.parse(expected))
      : actual === expected;

    if (!matches) {
      throw new Error(
        `${file} does not match release ${version}. Run bun run version:sync.`,
      );
    }
  }
}

function run(command, args) {
  const executable =
    process.platform === "win32" && command === "bun" ? "bun.exe" : command;
  execFileSync(executable, args, { cwd: root, stdio: "inherit" });
}

function validateRelease(currentVersion, nextVersion) {
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  if (status.trim()) {
    throw new Error("Commit your work before creating a release.");
  }
  if (buildNumber(nextVersion) <= buildNumber(currentVersion)) {
    throw new Error("The release must be newer than the current version.");
  }

  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", `refs/tags/v${nextVersion}`],
      {
        cwd: root,
        stdio: "ignore",
      },
    );
  } catch (error) {
    if (error.status) {
      return;
    }
    throw error;
  }
  throw new Error("Tag already exists.");
}

function main(args) {
  const packagePath = path.join(root, "package.json");
  const currentVersion = JSON.parse(
    fs.readFileSync(packagePath, "utf8"),
  ).version;
  if (args[0] === "--check") {
    checkVersions(root, args[1] || currentVersion);
    return;
  }

  const syncOnly = args[0] === "--sync";
  const requestedVersion = syncOnly ? args[1] : args[0];
  const version = requestedVersion || (syncOnly ? currentVersion : "");
  versionParts(version);
  if (!syncOnly) {
    validateRelease(currentVersion, version);
  }

  const files = versionFiles(root, version);
  for (const [file, contents] of files) {
    fs.writeFileSync(path.join(root, file), contents);
  }

  const jsonFiles = [...files.keys()].filter((file) => file.endsWith(".json"));
  run("bun", ["x", "prettier", "--write", ...jsonFiles]);
  run("bun", ["install", "--lockfile-only", "--ignore-scripts"]);
  if (syncOnly) {
    return;
  }

  run("git", ["add", "--", ...files.keys(), "bun.lock"]);
  run("git", ["commit", "-m", `Release ${version}`]);
  run("git", ["tag", "-a", `v${version}`, "-m", `Parson ${version}`]);
  console.log(
    `Prepared v${version}. Publish with: git push origin HEAD --follow-tags`,
  );
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { versionParts, versionFiles, checkVersions };
