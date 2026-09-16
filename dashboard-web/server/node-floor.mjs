const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 24 || (major === 24 && minor < 21)) {
  console.error(`trajecktory needs Node.js 24.21 or later (found v${process.versions.node}). Run the latest trajecktory installer, or install Node.js 24.21 LTS.`);
  process.exit(1);
}
