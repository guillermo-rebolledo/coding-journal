const requiredMajor = 24;

export function getUnsupportedNodeMessage(version) {
  const normalizedVersion = version.startsWith("v") ? version : `v${version}`;
  const currentMajor = Number.parseInt(
    normalizedVersion.slice(1).split(".")[0] ?? "",
    10,
  );

  if (currentMajor === requiredMajor) {
    return null;
  }

  return `Coding Journal requires Node.js ${requiredMajor}.x, but ${normalizedVersion} is active. Run \`nvm use\` and try again.`;
}

const unsupportedNodeMessage = getUnsupportedNodeMessage(process.version);

if (unsupportedNodeMessage) {
  console.error(unsupportedNodeMessage);
  process.exit(1);
}
