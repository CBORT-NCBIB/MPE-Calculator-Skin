// Entry point for esbuild to produce a self-contained Ajv 8 bundle.
//
// The bundle is consumed by web/build.py: it reads the esbuild output and
// inlines it into index.html via a <script> tag.  The resulting bundle
// exposes the Ajv 2020 constructor on globalThis as `Ajv2020`, which the
// main-thread LSP validator (web/lsp/validate.js) consumes when running
// in the browser.
//
// Build command (invoked by web/build.py):
//   npx esbuild web/build_ajv_entry.js --bundle --minify --format=iife \
//       --target=es2019 --outfile=<temp>
//
// Why "ajv/dist/2020.js"?  Ajv 8 ships two top-level entry points:
//   - "ajv"            : draft-07 validator
//   - "ajv/dist/2020"  : draft 2020-12 validator
// Our LSP schema declares `"$schema": "https://json-schema.org/draft/2020-12/schema"`,
// so we MUST use the 2020 entry to get the correct keyword set (notably
// `prefixItems`, `unevaluatedProperties`, and the corrected `$dynamicRef`
// resolution).  Using the wrong entry would cause silent validation gaps.
//
// IIFE format: produces a single self-executing function that runs at load
// time, defining no external module symbols.  This is the only format
// compatible with our inline-script bundling approach (no AMD/UMD loader,
// no ES module resolver).
const Ajv2020 = require("ajv/dist/2020.js").default;

if (typeof globalThis !== "undefined") {
  globalThis.Ajv2020 = Ajv2020;
} else if (typeof window !== "undefined") {
  window.Ajv2020 = Ajv2020;
}
