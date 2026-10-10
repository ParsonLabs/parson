const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  configureBuildCommand,
  createYargs,
} = require("electron-builder/out/builder");

const buildScript = path.resolve(__dirname, "../scripts/build.cjs");

function packagingArguments(platform, architecture) {
  let arguments;
  let buildEnvironment;
  const mockedRequire = (name) => {
    if (name === "node:child_process") {
      return {
        spawnSync: (command, args, options) => {
          assert.equal(command, process.execPath);
          arguments = args.slice(1);
          buildEnvironment = options.env;
          return { status: 0 };
        },
      };
    }
    if (name === "node:fs") {
      return { existsSync: () => false };
    }
    if (name === "../../../tools/generate-third-party-notices.cjs") {
      return { generateThirdPartyNotices: () => {} };
    }
    return require(name);
  };
  mockedRequire.resolve = require.resolve;

  vm.runInNewContext(readFileSync(buildScript, "utf8"), {
    require: mockedRequire,
    __dirname: path.dirname(buildScript),
    process: {
      execPath: process.execPath,
      env: {
        PARSON_BUILD_PLATFORM: platform,
        PARSON_BUILD_ARCH: architecture,
      },
    },
  });

  const options = createYargs()
    .command(["build", "*"], "Build", configureBuildCommand)
    .exitProcess(false)
    .strict()
    .parseSync(arguments);
  return { ...options, buildEnvironment };
}

for (const architecture of ["x64", "arm64"]) {
  test(`Windows ${architecture} packaging selects both installer targets`, () => {
    const options = packagingArguments("win32", architecture);
    assert.deepEqual(options.win, ["nsis", "portable"]);
    assert.equal(options.buildEnvironment.ELECTRON_BUILDER_7Z_FILTER, "BCJ");
    assert.equal(options[architecture], true);
    assert.equal(options.publish, "never");
  });

  test(`macOS ${architecture} packaging selects both distribution targets`, () => {
    const options = packagingArguments("darwin", architecture);
    assert.deepEqual(options.mac, ["dmg", "zip"]);
    assert.equal(options[architecture], true);
    assert.equal(options.publish, "never");
  });
}
