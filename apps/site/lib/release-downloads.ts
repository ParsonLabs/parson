export const releaseVersion = "1.0.0";
export const releaseTag = `v${releaseVersion}`;
export const releaseBase =
  `https://github.com/ParsonLabs/Parson/releases/download/${releaseTag}` as const;
export const releasePage =
  `https://github.com/ParsonLabs/Parson/releases/tag/${releaseTag}` as const;

export const releaseDownloads = {
  windowsX64: `${releaseBase}/Parson_${releaseVersion}_x64-setup.exe`,
  windowsArm64: `${releaseBase}/Parson_${releaseVersion}_arm64-setup.exe`,
  linuxX64AppImage: `${releaseBase}/Parson_${releaseVersion}_x86_64.AppImage`,
  linuxArm64AppImage: `${releaseBase}/Parson_${releaseVersion}_arm64.AppImage`,
  linuxX64Deb: `${releaseBase}/Parson_${releaseVersion}_amd64.deb`,
  linuxArm64Deb: `${releaseBase}/Parson_${releaseVersion}_arm64.deb`,
  macX64Dmg: `${releaseBase}/Parson_${releaseVersion}_x64.dmg`,
  macArm64Dmg: `${releaseBase}/Parson_${releaseVersion}_arm64.dmg`,
  windowsServer: `${releaseBase}/ParsonMusicServer-${releaseVersion}-win-x64.zip`,
  checksums: `${releaseBase}/SHA256SUMS`,
} as const;
