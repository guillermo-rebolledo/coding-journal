const requiredMajor = 24;
const currentMajor = Number.parseInt(
  process.versions.node.split(".")[0] ?? "",
  10,
);

if (currentMajor !== requiredMajor) {
  console.error(
    `Coding Journal requires Node.js ${requiredMajor}.x, but ${process.version} is active. Run \`nvm use\` and try again.`,
  );
  process.exit(1);
}
