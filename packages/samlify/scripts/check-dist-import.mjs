const entrypoint = new URL("../dist/index.js", import.meta.url);

try {
  await import(entrypoint.href);
} catch (error) {
  console.error("Failed to import built @robelest/samlify entrypoint.");
  console.error(error);
  process.exit(1);
}
