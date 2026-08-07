import { createServer } from "../index.js";

async function main(): Promise<void> {
  const port = Number(process.env["PORT"] ?? "8787");
  const host = process.env["HOST"] ?? "127.0.0.1";
  const app = createServer();
  const bound = await app.listen(port, host);
  process.stdout.write(`null-city server listening on http://${host}:${bound}\n`);
  process.stdout.write("player transport: REST + WebSocket (no raw snapshot/truth events)\n");
}

main().catch((error) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
