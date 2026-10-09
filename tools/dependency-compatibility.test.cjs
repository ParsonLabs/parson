const assert = require("node:assert/strict");
const test = require("node:test");
const queryString = require("query-string");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const asar = require("@electron/asar");

test(
  "desktop packaging completes with compatible glob callbacks",
  { timeout: 5000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "parson-asar-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = path.join(root, "source");
    const archive = path.join(root, "app.asar");
    await fs.mkdir(source);
    await fs.writeFile(
      path.join(source, "main.js"),
      "module.exports = 'Parson';\n",
    );
    await asar.createPackage(source, archive);
    assert.equal(
      asar.extractFile(archive, "main.js").toString(),
      "module.exports = 'Parson';\n",
    );
  },
);

test("router query parsing interoperates with the updated URI decoder", () => {
  assert.deepEqual(
    {
      ...queryString.parse(
        "title=Hello%20World&artist=Ren%C3%A9&tag=one&tag=two",
      ),
    },
    { artist: "René", tag: ["one", "two"], title: "Hello World" },
  );
  const parsed = queryString.parseUrl(
    "parson://album?id=sample%2Falbum&query=one%20two#lyrics",
    { parseFragmentIdentifier: true },
  );
  assert.equal(parsed.url, "parson://album");
  assert.deepEqual(
    { ...parsed.query },
    { id: "sample/album", query: "one two" },
  );
  assert.equal(parsed.fragmentIdentifier, "lyrics");
});

test("router query parsing tolerates incomplete percent escapes", () => {
  const parsed = queryString.parse("query=hello%20world%&value=%E0%A4%A");
  assert.equal(parsed.query, "hello world%");
  assert.equal(typeof parsed.value, "string");
  assert.match(parsed.value, /%A/);
});
