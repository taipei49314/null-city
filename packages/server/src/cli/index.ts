import { createServer } from "../index.js";

function parsePort(args: string[]): number {
  const flag = args.indexOf("--port");
  if (flag !== -1 && args[flag + 1]) {
    const parsed = Number(args[flag + 1]);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 8787;
}

async function main(): Promise<void> {
  const port = parsePort(process.argv.slice(2));
  const app = createServer();
  const bound = await app.listen(port, "127.0.0.1");
  process.stdout.write(`NULL CITY server listening on http://127.0.0.1:${bound}\n`);
  process.stdout.write(`  REST   http://127.0.0.1:${bound}/sessions\n`);
  process.stdout.write(`  WS     ws://127.0.0.1:${bound}/ws/<sessionId>\n`);
  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main();