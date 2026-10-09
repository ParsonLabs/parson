# Dependency Security Patches

Three dependencies have advisories without published upstream fixes. Parson applies local patches through Bun and verifies them before excluding those exact advisory IDs from its dependency audit.

| Dependency         | Advisory                                                                 | Fix                                                                |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `braces@3.0.3`     | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Bound parser and AST traversal nesting.                            |
| `node-forge@1.4.0` | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Reject extra elements in the nested RSA digest algorithm sequence. |
| `sprintf-js@1.1.3` | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | Reject excessive format widths and precisions before formatting.   |

`bun run audit:dependencies` runs the regression tests in `tools/security-patches.test.cjs`, checks that the patches are configured, and audits the complete dependency graph. Missing patches, failed regression tests, and other advisories fail the check. An ordinary `bun audit` still reports these three package versions because the registry cannot recognise local patches.

Replace each patch with a verified upstream release when one becomes available, then remove its corresponding advisory exclusion and regression-specific expectations.

The `query-string` patch preserves Expo Router's decoding API when using the patched ESM URI decoder. The audio patch preserves Parson's native playback API. Dependency compatibility tests also exercise Electron archive packaging, which requires the older callback-based Glob API; the security override applies only to the affected minifier's Glob dependency.

Expo SDK 57 requires React 19.2 types and ESLint 9. These remain on their latest compatible releases, while the web clients use React 19.3 and TypeScript 7.
