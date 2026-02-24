const { notarize } = require("@electron/notarize");
const { existsSync } = require("fs");
const { join } = require("path");
const { spawnSync } = require("child_process");

function verifyFfmpegSignature(appPath) {
  const ffmpegPath = join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "ffmpeg-static",
    "ffmpeg"
  );

  if (!existsSync(ffmpegPath)) {
    console.warn(`FFmpeg binary not found for signature check: ${ffmpegPath}`);
    return;
  }

  const result = spawnSync("codesign", ["-dv", "--verbose=4", ffmpegPath], {
    encoding: "utf8",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const hasTeamIdentifier = /TeamIdentifier=(?!not set).+/.test(output);

  if (!hasTeamIdentifier) {
    console.warn(
      "FFmpeg appears to be ad-hoc signed. Screen recording can fail on macOS TCC if the FFmpeg helper binary is not properly signed."
    );
  } else {
    console.log("FFmpeg signature check passed.");
  }
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  if (process.env.NOTARIZE !== "true") {
    console.log("Skipping notarization: NOTARIZE is not set to true");
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log("Skipping notarization: missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  verifyFfmpegSignature(appPath);

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log("Notarization complete!");
};
