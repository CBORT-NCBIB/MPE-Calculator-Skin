#!/usr/bin/env node
/**
 * Compute SRI (Subresource Integrity) hashes for all CDN scripts used in the calculator.
 * Run: node web/compute-sri.js
 * 
 * After running, update the <script> tags in web/build.py with the printed integrity attributes.
 */

const https = require("https");
const crypto = require("crypto");

const scripts = [
  { name: "react", url: "https://unpkg.com/react@18.2.0/umd/react.production.min.js" },
  { name: "react-dom", url: "https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js" },
  { name: "recharts", url: "https://unpkg.com/recharts@2.12.7/umd/Recharts.js" },
  { name: "plotly-basic", url: "https://cdn.plot.ly/plotly-basic-2.35.2.min.js" },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetch(res.headers.location).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function main() {
  console.log("Computing SRI hashes for CDN scripts...\n");
  for (const s of scripts) {
    try {
      const buf = await fetch(s.url);
      const hash = crypto.createHash("sha384").update(buf).digest("base64");
      const sri = `sha384-${hash}`;
      console.log(`${s.name}:`);
      console.log(`  URL: ${s.url}`);
      console.log(`  integrity="${sri}" crossorigin="anonymous"`);
      console.log(`  Size: ${(buf.length / 1024).toFixed(1)} KB\n`);
    } catch (err) {
      console.log(`${s.name}: FAILED (${err.message})\n`);
    }
  }
  console.log("Add integrity and crossorigin attributes to the <script> tags in web/build.py");
}

main();
