/**
 * Configuration: which standard data file to use.
 *
 * Change this path to switch the entire calculator to a
 * different standard. The web UI, engine, and all exports
 * will automatically use the new standard's values.
 *
 * Options shipped with this repository:
 *   "./standards/icnirp_2013.json"  (default)
 *
 * To add your own:
 *   1. Copy icnirp_2013.json to a new file in web/standards/
 *   2. Edit the values to match your standard
 *   3. Update the path below
 *   4. Rebuild index.html (run the build script)
 */
var STANDARD_PATH = "./standards/icnirp_2013.json";

if (typeof module !== "undefined" && module.exports) {
  module.exports = { STANDARD_PATH: STANDARD_PATH };
}
