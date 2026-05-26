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

async function preparePcShareFile(session, id, fileName, body) {
  const start = await fetch(`${baseUrl}/share/start?session=${session}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, fileName, size: body.length })
  });
  assert.equal(start.status, 200);

  const chunk = await fetch(`${baseUrl}/share/chunk?session=${session}&id=${id}&offset=0`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body
  });
  assert.equal(chunk.status, 200);

  const finish = await fetch(`${baseUrl}/share/finish?session=${session}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
  assert.equal(finish.status, 200);
  const finished = await finish.json();
  assert.equal(finished.ok, true);
  assert.match(finished.shareUrl, /\/share\?/);
  assert.match(finished.qrCode, /^data:image\/png;base64,/);

  return finished;
}

test("PC share flow prepares a file for phone download", async () => {
  const session = `test-${Date.now()}`;
  const id = "pc-share-test";
  const fileName = "arquivo-do-pc.txt";
  const body = Buffer.from("conteudo enviado do pc");
  const finished = await preparePcShareFile(session, id, fileName, body);

  const sharePath = new URL(finished.shareUrl).pathname + new URL(finished.shareUrl).search;
  const sharePage = await fetch(`${baseUrl}${sharePath}`);
  assert.equal(sharePage.status, 200);

  const infoUrl = finished.shareUrl.replace("/share?", "/share/info?");
  const info = await fetch(`${baseUrl}${new URL(infoUrl).pathname}${new URL(infoUrl).search}`);
  assert.equal(info.status, 200);
  const shareInfo = await info.json();
  assert.equal(shareInfo.fileName, fileName);

  const download = await fetch(`${baseUrl}${shareInfo.downloadUrl}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), body.toString());
});

test("PC share flow creates a QR bundle with multiple files", async () => {
  const session = `bundle-${Date.now()}`;
  const files = [
    { id: "pc-share-a", fileName: "primeiro.txt", body: Buffer.from("primeiro arquivo") },
    { id: "pc-share-b", fileName: "segundo.txt", body: Buffer.from("segundo arquivo") }
  ];
  const finished = [];

  for (const file of files) {
    finished.push(await preparePcShareFile(session, file.id, file.fileName, file.body));
  }

  const bundle = await fetch(`${baseUrl}/share/bundle?session=${session}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: finished.map((file) => file.id) })
  });
  assert.equal(bundle.status, 200);

  const bundled = await bundle.json();
  assert.equal(bundled.ok, true);
  assert.equal(bundled.mode, "bundle");
  assert.equal(bundled.fileCount, 2);
  assert.match(bundled.shareUrl, /bundle=/);
  assert.match(bundled.qrCode, /^data:image\/png;base64,/);

  const infoUrl = bundled.shareUrl.replace("/share?", "/share/info?");
  const info = await fetch(`${baseUrl}${new URL(infoUrl).pathname}${new URL(infoUrl).search}`);
  assert.equal(info.status, 200);

  const shareInfo = await info.json();
  assert.equal(shareInfo.mode, "bundle");
  assert.equal(shareInfo.files.length, 2);
  assert.equal(shareInfo.totalSize, files[0].body.length + files[1].body.length);

  for (const [index, fileInfo] of shareInfo.files.entries()) {
    assert.equal(fileInfo.fileName, files[index].fileName);
    const download = await fetch(`${baseUrl}${fileInfo.downloadUrl}`);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), files[index].body.toString());
  }
});
