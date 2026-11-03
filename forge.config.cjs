// Electron Forge configuration (Forge 7.11). The app is built with Vite first (`npm run build`), then Forge
// packages dist/, dist-electron/, the database migrations and the icons. Nothing from node_modules is needed at runtime.
const path = require("node:path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const pkg = require("./package.json");

const homepage = pkg.homepage;

/** Only these top-level paths go into the app archive. */
const KEEP = [/^\/package\.json$/, /^\/dist(\/|$)/, /^\/dist-electron(\/|$)/, /^\/database(\/migrations(\/|$)|$)/, /^\/resources(\/icons(\/(icon\.png)?)?)?$/];
/** Developer-only tools never ship (they are also disabled in packaged builds). */
const DROP = [/^\/dist-electron\/main\/(perf|diag)-[^/]+\.cjs$/, /\.map$/];

module.exports = {
  packagerConfig: {
    name: "SIDB",
    executableName: "SIDB",
    appBundleId: "app.sidb.browser",
    appCopyright: `Copyright ${new Date().getFullYear()} SIDB`,
    icon: path.join(__dirname, "resources", "icons", "icon"), // .ico on Windows, .png on Linux
    asar: true,
    prune: false, // node_modules is not packaged at all (see KEEP)
    // Called with paths relative to the project ("/dist/index.html"); "" is the project folder itself.
    ignore: (file) => (file === "" ? false : !KEEP.some((r) => r.test(file)) || DROP.some((r) => r.test(file))),
    win32metadata: {
      CompanyName: "SIDB",
      FileDescription: "SIDB Browser",
      ProductName: "SIDB",
      InternalName: "SIDB",
    },
  },
  makers: [
    // The Windows installer (Squirrel) is NOT part of v0.1.0 releases: its normal, visible install did not finish on
    // GitHub's Windows machines (see progress.md). It is only built when SIDB_BUILD_INSTALLER=1, for the manual
    // "Windows installer (experimental)" workflow job.
    ...(process.env.SIDB_BUILD_INSTALLER === "1" ? [{
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "SIDB",
        authors: "SIDB",
        description: pkg.description,
        setupIcon: path.join(__dirname, "resources", "icons", "icon.ico"),
        // Optional code signing: set WINDOWS_CERTIFICATE_FILE and WINDOWS_CERTIFICATE_PASSWORD. Without a certificate
        // Windows SmartScreen shows "Unknown publisher" on first run.
        ...(process.env.WINDOWS_CERTIFICATE_FILE ? { certificateFile: process.env.WINDOWS_CERTIFICATE_FILE, certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD } : {}),
      },
    }] : []),
    { name: "@electron-forge/maker-zip", platforms: ["win32", "linux"] },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: { options: { name: "sidb", bin: "SIDB", productName: "SIDB", genericName: "Web Browser", categories: ["Network", "WebBrowser"], icon: path.join(__dirname, "resources", "icons", "icon.png"), maintainer: "SIDB", homepage, mimeType: ["text/html", "x-scheme-handler/http", "x-scheme-handler/https"] } },
    },
    {
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: { options: { name: "sidb", bin: "SIDB", productName: "SIDB", genericName: "Web Browser", categories: ["Network", "WebBrowser"], icon: path.join(__dirname, "resources", "icons", "icon.png"), license: "Proprietary", homepage } },
    },
  ],
  // Releases are created by .github/workflows/release.yml (with the gh CLI), not by Forge's publisher: two build
  // machines publishing at once would each create their own draft release.
  publishers: [],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false, // ELECTRON_RUN_AS_NODE can't turn SIDB into a plain Node.js
      [FuseV1Options.EnableCookieEncryption]: true, // cookies encrypted with the OS key store
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // NODE_OPTIONS is ignored
      [FuseV1Options.EnableNodeCliInspectArguments]: false, // --inspect is ignored
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, // a modified app.asar refuses to load
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false, // the UI is served from sidb-app://, not file://
    }),
  ],
};
