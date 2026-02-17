/** @type {import("lage").ConfigFileOptions} */
const config = {
  pipeline: {
    build: ["^build"],
    test: ["build"],
    lint: []
  },
  cacheOptions: {
    outputGlob: ["dist/**/*", "build/**/*", "out/**/*"],
    environmentGlob: ["package.json", "package-lock.json", "lage.config.js"]
  }
};

module.exports = config;
