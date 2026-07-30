const fs = require("node:fs");
const path = require("node:path");

const workspace = path.resolve(__dirname, "..");
const output = path.join(workspace, "THIRD_PARTY_NOTICES.md");
const notice = `# Third-party notices

Parson is distributed under the GNU General Public License version 3 only. The
complete license text is included as \`LICENSE\`.

Binary packages also contain third-party software. Those components retain
their own licenses:

- Desktop packages include Electron and Chromium license files.
- Rust dependencies and their exact versions are listed in \`Cargo.lock\`.
- JavaScript dependencies and their exact versions are listed in \`bun.lock\`.
- Container images retain operating-system package notices under
  \`/usr/share/doc\`.

The corresponding source and locked dependency manifests are available from
the release tag at <https://github.com/ParsonLabs/Parson>.
`;

function generateThirdPartyNotices(destination = output) {
  fs.writeFileSync(destination, notice);
  return destination;
}

if (require.main === module) {
  process.stdout.write(`${generateThirdPartyNotices()}\n`);
}

module.exports = { generateThirdPartyNotices, notice };
