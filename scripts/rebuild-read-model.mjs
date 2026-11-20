// Demo of "the log is the source of truth": empty Cassandra's message table, then rebuild it
// by replaying chat.messages with a brand-new persister group (ADR-002, ADR-016).
// Usage: pnpm db:rebuild   (infrastructure up; the chat servers may keep running)
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const TIMEOUT_MS = 180_000;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const cql = (statement) => docker("exec", "wa-cassandra", "cqlsh", "-e", statement);

function storedMessages() {
  const out = cql("SELECT COUNT(*) FROM chat.messages_by_conversation;");
  return Number(out.match(/^\s*(\d+)\s*$/m)?.[1] ?? NaN);
}

function loggedRecords() {
  const out = docker(
    "exec",
    "wa-kafka",
    "kafka-get-offsets.sh",
    "--bootstrap-server",
    "localhost:9092",
    "--topic",
    "chat.messages",
  );
  return out.split("\n").reduce((sum, line) => sum + Number(line.split(":")[2] ?? 0), 0);
}

const records = loggedRecords();
console.log(`chat.messages holds ${records} records; Cassandra holds ${storedMessages()} messages`);

cql("TRUNCATE chat.messages_by_conversation;");
console.log(`Truncated messages_by_conversation: ${storedMessages()} messages left`);

const group = `persister-rebuild-${Date.now()}`;
console.log(`Replaying from offset 0 with a new consumer group: ${group}`);
// A third server process: its own port and id, and a group with no committed offsets.
const child = spawn("pnpm", ["--filter", "@wa/chat-server", "start"], {
  env: { ...process.env, PORT: "4009", SERVER_ID: "rebuild", PERSISTER_GROUP: group },
  shell: true,
  stdio: "ignore",
  detached: process.platform !== "win32",
});

function stop() {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}

const started = Date.now();
let stored = 0;
try {
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(2000);
    stored = storedMessages();
    process.stdout.write(
      `\r  ${stored} / ${records} messages back after ${Math.round((Date.now() - started) / 1000)} s`,
    );
    if (stored >= records) break;
  }
} finally {
  stop();
}
console.log("");
if (stored < records) {
  console.error(
    `Stopped after ${TIMEOUT_MS / 1000} s with ${stored} of ${records}; see the server log`,
  );
  process.exit(1);
}
console.log(
  `Rebuilt: every message in the log is back in Cassandra. Group ${group} can be deleted:`,
);
console.log(
  `  docker exec wa-kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --delete --group ${group}`,
);
