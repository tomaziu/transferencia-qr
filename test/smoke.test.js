const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const STARTUP_TIMEOUT_MS = 15000;

function waitForServer(port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/state`);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Server still starting.
      }

      if (Date.now() >= deadline) {
        reject(new Error(`Server did not start on port ${port} within ${STARTUP_TIMEOUT_MS}ms`));
        return;
      }

      setTimeout(attempt, 200);
    };

    attempt();
  });
}

let serverProcess;
let baseUrl;

before(async () => {
  const port = 30000 + Math.floor(Math.random() * 10000);

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let startupError = "";
  serverProcess.stderr.on("data", (chunk) => {
    startupError += chunk.toString();
  });
  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      startupError += `\nServer exited with code ${code}`;
    }
  });

  try {
    await waitForServer(port);
  } catch (error) {
    serverProcess.kill();
    throw new Error(`${error.message}\n${startupError}`.trim());
  }

  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});

test("GET / serves the desktop page", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Receber arquivos/);
});

test("GET /api/config returns QR and send URL", async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  assert.equal(response.status, 200);

  const config = await response.json();
  assert.equal(typeof config.sendUrl, "string");
  assert.match(config.sendUrl, /\/send\?key=/);
  assert.match(config.qrCode, /^data:image\/png;base64,/);
});

test("GET /api/state returns active transfers and history", async () => {
  const response = await fetch(`${baseUrl}/api/state`);
  assert.equal(response.status, 200);

  const state = await response.json();
  assert.ok(Array.isArray(state.active));
  assert.ok(Array.isArray(state.history));
});

test("GET /send without key shows expired page", async () => {
  const response = await fetch(`${baseUrl}/send`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /expirado|expirada/i);
});
