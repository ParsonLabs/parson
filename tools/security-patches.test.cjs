const assert = require("node:assert/strict");
const test = require("node:test");
const braces = require("braces");
const forge = require("node-forge");
const { sprintf } = require("sprintf-js");

test("brace patterns reject excessive nesting before recursive traversal", () => {
  assert.deepEqual(braces.expand("file-{a,b}.txt"), [
    "file-a.txt",
    "file-b.txt",
  ]);
  for (const opening of ["{", "("]) {
    const closing = opening === "{" ? "}" : ")";
    assert.throws(
      () => braces(opening.repeat(1000) + "a,b" + closing.repeat(1000)),
      /nesting exceeds the depth limit/,
    );
  }
  let ast = { type: "text", value: "leaf" };
  for (let depth = 0; depth < 1000; depth++) {
    ast = { type: "root", nodes: [ast] };
  }
  for (const operation of [braces.compile, braces.stringify]) {
    assert.throws(() => operation(ast), /nesting exceeds the depth limit/);
  }
});

test("RSA verification accepts only a valid nested digest algorithm", () => {
  const { privateKey, publicKey } = forge.pki.rsa.generateKeyPair(1024);
  const digest = forge.md.sha256.create().update("a signed test message");
  assert.equal(
    publicKey.verify(digest.digest().bytes(), privateKey.sign(digest)),
    true,
  );
  const asn1 = forge.asn1;
  const digestBytes = digest.digest().bytes();
  const signDigestInfo = (parameters) => {
    const algorithm = asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.SEQUENCE,
      true,
      [
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(forge.oids.sha256).getBytes(),
        ),
        ...parameters,
      ],
    );
    const digestInfo = asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.SEQUENCE,
      true,
      [
        algorithm,
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OCTETSTRING,
          false,
          digestBytes,
        ),
      ],
    );
    return privateKey.sign(asn1.toDer(digestInfo).getBytes(), "NONE");
  };
  assert.equal(publicKey.verify(digestBytes, signDigestInfo([])), true);
  for (const parameters of [
    [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ""),
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OCTETSTRING,
        false,
        "unexpected",
      ),
    ],
    [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OCTETSTRING,
        false,
        "unexpected",
      ),
    ],
    [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, "unexpected")],
  ]) {
    assert.throws(
      () => publicKey.verify(digestBytes, signDigestInfo(parameters)),
      /valid RSASSA-PKCS1-v1_5 DigestInfo/,
    );
  }
});

test("format strings reject unbounded widths and precisions", () => {
  assert.equal(sprintf("%.2f", 1.25), "1.25");
  assert.equal(sprintf("%5s", "ok"), "   ok");
  for (const format of [
    "%.1000000000f",
    "%1000000000s",
    "%.999999999999999999999999g",
  ]) {
    assert.throws(
      () => sprintf(format, 1),
      /width or precision exceeds the limit/,
    );
  }
});
