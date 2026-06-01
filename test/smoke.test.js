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

async function getSendKey() {
  const configResponse = await fetch(`${baseUrl}/api/config`);
  const config = await configResponse.json();
  return new URL(config.sendUrl).searchParams.get("key");
}

async function getSendCredentials() {
  const configResponse = await fetch(`${baseUrl}/api/config`);
  const config = await configResponse.json();
  const key = new URL(config.sendUrl).searchParams.get("key");

  const verify = await fetch(`${baseUrl}/api/pin/verify?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: config.pin })
  });
  assert.equal(verify.status, 200);

  const verified = await verify.json();
  assert.equal(verified.ok, true);
  assert.equal(typeof verified.auth, "string");

  return { key, auth: verified.auth, sessionId: config.sessionId, pin: config.pin };
}

test("GET / serves the desktop page", async () => {
  const response = await fetch(`${baseUrl}/`, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36"
    }
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Receber arquivos/);
  assert.match(body, /sharedNote/);
  assert.match(body, /suggestionTitleInput/);
  assert.match(body, /suggestionSendButton/);
  assert.match(body, /shareFolderInput/);
  assert.match(body, /webkitdirectory/);
  assert.match(body, /deviceList/);
  assert.match(body, /qrStatusText/);
  assert.match(body, /notifyButton/);
  assert.match(body, /shareReadyItems/);
});

test("GET /api/config returns QR and send URL", async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  assert.equal(response.status, 200);

  const config = await response.json();
  assert.equal(typeof config.sendUrl, "string");
  assert.match(config.pin, /^\d{6}$/);
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

test("GET /send with key serves folder-capable sender page", async () => {
  const key = await getSendKey();

  const response = await fetch(`${baseUrl}/send?key=${key}`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /folderInput/);
  assert.match(body, /webkitdirectory/);
  assert.match(body, /sharedNote/);
});

test("mobile user agent gets sender landing with camera option", async () => {
  const response = await fetch(`${baseUrl}/`, {
    headers: {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
    }
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Enviar arquivos/);
  assert.match(body, /Abrir câmera e ler QR/);
  assert.match(body, /mobile\.js/);
  assert.doesNotMatch(body, /id="qrImage"/);
});

test("mobile root with key redirects to send page", async () => {
  const key = await getSendKey();
  const response = await fetch(`${baseUrl}/?key=${encodeURIComponent(key)}`, {
    redirect: "manual",
    headers: {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
    }
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") || "", /\/send\?key=/);
});

test("GET /send without key shows expired page", async () => {
  const response = await fetch(`${baseUrl}/send`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /expirado|expirada/i);
});

test("phone PIN unlocks mobile APIs", async () => {
  const configResponse = await fetch(`${baseUrl}/api/config`);
  const config = await configResponse.json();
  const key = new URL(config.sendUrl).searchParams.get("key");

  const blocked = await fetch(`${baseUrl}/api/note?key=${key}`);
  assert.equal(blocked.status, 403);
  const blockedData = await blocked.json();
  assert.equal(blockedData.pinRequired, true);

  const wrong = await fetch(`${baseUrl}/api/pin/verify?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: "000000" })
  });
  assert.equal(wrong.status, config.pin === "000000" ? 200 : 403);

  const verify = await fetch(`${baseUrl}/api/pin/verify?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: config.pin })
  });
  assert.equal(verify.status, 200);
  const verified = await verify.json();
  assert.equal(typeof verified.auth, "string");

  const status = await fetch(`${baseUrl}/api/pin/status?key=${key}&auth=${verified.auth}`);
  assert.equal(status.status, 200);
  const statusData = await status.json();
  assert.equal(statusData.verified, true);
});

test("shared note syncs between phone key and desktop session", async () => {
  const { key, auth, sessionId } = await getSendCredentials();
  const text = `nota compartilhada ${Date.now()}`;

  const save = await fetch(`${baseUrl}/api/note?key=${key}&auth=${auth}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(saved.note.text, text);

  const read = await fetch(`${baseUrl}/api/note?session=${sessionId}`);
  assert.equal(read.status, 200);
  const data = await read.json();
  assert.equal(data.note.text, text);
});

test("pin toggle works on hosted-style requests", async () => {
  const configResponse = await fetch(`${baseUrl}/api/config`);
  const config = await configResponse.json();

  const toggle = await fetch(`${baseUrl}/api/pin/toggle?session=${encodeURIComponent(config.sessionId)}`, {
    method: "POST",
    headers: { host: "transferencia-qr.onrender.com" }
  });
  assert.equal(toggle.status, 200);

  const data = await toggle.json();
  assert.equal(data.ok, true);
  assert.equal(data.pinEnabled, false);
});

test("desktop can renew QR and invalidate old phone access", async () => {
  const { key, auth, sessionId } = await getSendCredentials();

  const renew = await fetch(`${baseUrl}/api/session/renew?session=${sessionId}`, { method: "POST" });
  assert.equal(renew.status, 200);
  const renewed = await renew.json();
  assert.equal(renewed.ok, true);
  assert.notEqual(new URL(renewed.sendUrl).searchParams.get("key"), key);
  assert.match(renewed.pin, /^\d{6}$/);

  const oldStatus = await fetch(`${baseUrl}/api/pin/status?key=${key}&auth=${auth}`);
  assert.equal(oldStatus.status, 403);
});

test("phone upload preserves folder path in saved name", async () => {
  const { key, auth } = await getSendCredentials();
  const id = `folder-upload-${Date.now()}`;
  const fileName = `pasta-teste-${Date.now()}/sub/arquivo.txt`;
  const body = Buffer.from("conteudo com pasta");

  const start = await fetch(`${baseUrl}/upload/start?key=${key}&auth=${auth}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, fileName, size: body.length })
  });
  assert.equal(start.status, 200);

  const chunk = await fetch(`${baseUrl}/upload/chunk?key=${key}&auth=${auth}&id=${id}&offset=0`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body
  });
  assert.equal(chunk.status, 200);

  const finish = await fetch(`${baseUrl}/upload/finish?key=${key}&auth=${auth}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
  assert.equal(finish.status, 200);

  const finished = await finish.json();
  assert.equal(finished.fileName, fileName);
  assert.equal(finished.savedName, fileName);

  const download = await fetch(`${baseUrl}${finished.downloadUrl}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), body.toString());
});

test("received image exposes preview URL", async () => {
  const { key, auth, sessionId } = await getSendCredentials();
  const id = `image-preview-${Date.now()}`;
  const fileName = `foto-${Date.now()}.png`;
  const body = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d
  ]);

  await fetch(`${baseUrl}/upload/start?key=${key}&auth=${auth}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, fileName, size: body.length })
  });
  await fetch(`${baseUrl}/upload/chunk?key=${key}&auth=${auth}&id=${id}&offset=0`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body
  });
  const finish = await fetch(`${baseUrl}/upload/finish?key=${key}&auth=${auth}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
  assert.equal(finish.status, 200);

  const state = await fetch(`${baseUrl}/api/state?session=${sessionId}`);
  const data = await state.json();
  const item = data.history.find((historyItem) => historyItem.id === id);
  assert.match(item.previewUrl, /preview=1/);

  const preview = await fetch(`${baseUrl}${item.previewUrl}`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-type"), /image\/png/);
});

test("mobile presence lists connected devices", async () => {
  const { key, auth, sessionId } = await getSendCredentials();
  const controller = new AbortController();
  const stream = fetch(`${baseUrl}/events?key=${key}&auth=${auth}`, {
    signal: controller.signal,
    headers: {
      "user-agent": "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A) AppleWebKit/537.36 Mobile Safari/537.36"
    }
  });

  const response = await stream;
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const state = await fetch(`${baseUrl}/api/state?session=${sessionId}`);
  const data = await state.json();
  assert.equal(data.mobile.connected, true);
  assert.equal(data.mobile.clients.length, 1);
  assert.match(data.mobile.clients[0].label, /SM-S918B|Android/);

  controller.abort();
  await response.body?.cancel().catch(() => {});
});

test("desktop can disconnect a connected phone", async () => {
  const { key, auth, sessionId } = await getSendCredentials();
  const controller = new AbortController();
  const stream = fetch(`${baseUrl}/events?key=${key}&auth=${auth}`, {
    signal: controller.signal,
    headers: {
      "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A) AppleWebKit/537.36 Mobile Safari/537.36"
    }
  });

  const response = await stream;
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const stateBefore = await fetch(`${baseUrl}/api/state?session=${sessionId}`);
  const before = await stateBefore.json();
  assert.equal(before.mobile.clients.length, 1);
  const clientId = before.mobile.clients[0].id;

  const disconnect = await fetch(`${baseUrl}/api/session/disconnect-mobile?session=${sessionId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId })
  });
  assert.equal(disconnect.status, 200);
  const disconnected = await disconnect.json();
  assert.equal(disconnected.ok, true);
  assert.equal(disconnected.state.mobile.clients.length, 0);

  const status = await fetch(`${baseUrl}/api/pin/status?key=${key}&auth=${auth}`);
  assert.equal(status.status, 200);
  const statusData = await status.json();
  assert.equal(statusData.verified, false);

  controller.abort();
  await response.body?.cancel().catch(() => {});
});

test("desktop can clear received history and old download links", async () => {
  const { key, auth, sessionId } = await getSendCredentials();
  const id = `clear-history-${Date.now()}`;
  const fileName = `limpar-${Date.now()}.txt`;
  const body = Buffer.from("arquivo para limpar historico");

  await fetch(`${baseUrl}/upload/start?key=${key}&auth=${auth}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, fileName, size: body.length })
  });
  await fetch(`${baseUrl}/upload/chunk?key=${key}&auth=${auth}&id=${id}&offset=0`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body
  });
  const finish = await fetch(`${baseUrl}/upload/finish?key=${key}&auth=${auth}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
  assert.equal(finish.status, 200);
  const finished = await finish.json();
  assert.match(finished.downloadUrl, /\/download\?/);

  const stateBefore = await fetch(`${baseUrl}/api/state?session=${sessionId}`);
  assert.equal((await stateBefore.json()).history.length, 1);

  const clear = await fetch(`${baseUrl}/api/history/clear?session=${sessionId}`, { method: "POST" });
  assert.equal(clear.status, 200);
  const cleared = await clear.json();
  assert.equal(cleared.state.history.length, 0);

  const download = await fetch(`${baseUrl}${finished.downloadUrl}`);
  assert.equal(download.status, 404);
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
    { id: "pc-share-a", fileName: "pasta/primeiro.txt", body: Buffer.from("primeiro arquivo") },
    { id: "pc-share-b", fileName: "pasta/sub/segundo.txt", body: Buffer.from("segundo arquivo") }
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
  assert.match(shareInfo.zipDownloadUrl, /\/share\/download-bundle\?/);

  for (const [index, fileInfo] of shareInfo.files.entries()) {
    assert.equal(fileInfo.fileName, files[index].fileName);
    const download = await fetch(`${baseUrl}${fileInfo.downloadUrl}`);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), files[index].body.toString());
  }

  const zip = await fetch(`${baseUrl}${shareInfo.zipDownloadUrl}`);
  assert.equal(zip.status, 200);
  assert.match(zip.headers.get("content-type"), /application\/zip/);
  const zipBody = Buffer.from(await zip.arrayBuffer());
  assert.equal(zipBody.subarray(0, 4).toString("hex"), "504b0304");
  assert.match(zipBody.toString("latin1"), /pasta\/primeiro\.txt/);
  assert.match(zipBody.toString("latin1"), /pasta\/sub\/segundo\.txt/);
});
