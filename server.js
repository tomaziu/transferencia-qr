const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_UPLOAD_DIR = path.join(ROOT, "recebidos");
const SETTINGS_FILE = path.join(ROOT, "transferencia-config.json");
const CHUNK_SIZE = 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

const sseClients = new Set();
const sessions = new Map();
let uploadDir = DEFAULT_UPLOAD_DIR;

const EXPIRED_QR_MESSAGE = "QR Code expirado. Atualize a pagina no computador e escaneie novamente.";

function getLanAddresses() {
  const results = [];
  const interfaces = os.networkInterfaces();

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;

      const address = entry.address;
      const isPrivate =
        address.startsWith("10.") ||
        address.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);
      const isLinkLocal = address.startsWith("169.254.");
      const isVirtual = /virtual|vmware|hyper-v|loopback|vbox|docker|wsl/i.test(name);

      results.push({
        name,
        address,
        url: `http://${address}:${PORT}`,
        score: (isPrivate ? 100 : 20) - (isLinkLocal ? 50 : 0) - (isVirtual ? 25 : 0)
      });
    }
  }

  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function createSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

function createSessionKey() {
  return crypto.randomBytes(24).toString("hex");
}

function safeSessionId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function createSession(id = createSessionId()) {
  const session = {
    id: safeSessionId(id) || createSessionId(),
    key: createSessionKey(),
    activeTransfers: new Map(),
    completedFiles: new Map(),
    history: [],
    configCache: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  sessions.set(session.id, session);
  return session;
}

function touchSession(session) {
  session.updatedAt = Date.now();
  return session;
}

function getOrCreateSession(id) {
  const safeId = safeSessionId(id);
  const existing = safeId ? sessions.get(safeId) : null;

  if (existing) return touchSession(existing);

  return createSession(safeId || createSessionId());
}

function sessionFromKey(url) {
  const key = String(url.searchParams.get("key") || "");
  if (!key) return null;

  for (const session of sessions.values()) {
    if (session.key === key) return touchSession(session);
  }

  return null;
}

function cleanupSessions() {
  const now = Date.now();

  for (const [id, session] of sessions) {
    if (session.activeTransfers.size > 0) continue;
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

function mobileUrl(session) {
  const [first] = getLanAddresses();
  const host = first ? first.address : "localhost";
  return `http://${host}:${PORT}/send?key=${session.key}`;
}

function requestOrigin(req) {
  if (!req) return null;

  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return null;

  const protocol = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${protocol}://${host}`;
}

function isLoopbackHost(host) {
  const hostname = String(host || "").replace(/^\[/, "").replace(/\]$/, "").split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function sendUrlForRequest(req, session) {
  const origin = requestOrigin(req);
  const host = String(req?.headers?.host || "").split(",")[0].trim();

  if (!origin || isLoopbackHost(host)) {
    return mobileUrl(session);
  }

  return `${origin}/send?key=${session.key}`;
}

async function getConfig(req, session) {
  const addresses = getLanAddresses();
  const sendUrl = sendUrlForRequest(req, session);

  if (session.configCache && session.configCache.sendUrl === sendUrl) {
    return {
      ...session.configCache,
      addresses: addresses.map((item) => ({
        name: item.name,
        address: item.address,
        url: `${item.url}/send?key=${session.key}`
      }))
    };
  }

  session.configCache = {
    sessionId: session.id,
    appUrl: `http://localhost:${PORT}`,
    sendUrl,
    qrCode: await QRCode.toDataURL(sendUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 9,
      color: {
        dark: "#102030",
        light: "#ffffff"
      }
    }),
    addresses: addresses.map((item) => ({
      name: item.name,
      address: item.address,
      url: `${item.url}/send?key=${session.key}`
    }))
  };

  return session.configCache;
}

async function loadSettings() {
  try {
    const raw = await fsp.readFile(SETTINGS_FILE, "utf8");
    const settings = JSON.parse(raw);

    if (typeof settings.destinationDir === "string" && settings.destinationDir.trim()) {
      const destinationDir = settings.destinationDir.trim();
      const isWindowsPathOnLinux = process.platform !== "win32" && /^[a-z]:[\\/]/i.test(destinationDir);
      uploadDir = isWindowsPathOnLinux ? DEFAULT_UPLOAD_DIR : path.resolve(destinationDir);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Nao foi possivel carregar a configuracao:", error.message);
    }
  }
}

async function saveSettings() {
  const body = JSON.stringify({ destinationDir: uploadDir }, null, 2);
  await fsp.writeFile(SETTINGS_FILE, body);
}

function sanitizeFileName(value) {
  const encodedName = String(value || "arquivo").trim();
  let rawName = encodedName;

  try {
    rawName = decodeURIComponent(encodedName);
  } catch {
    rawName = encodedName;
  }

  const baseName = path.basename(rawName).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  const cleaned = baseName.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 180) || "arquivo";
}

async function uniqueUploadPath(fileName) {
  await fsp.mkdir(uploadDir, { recursive: true });

  const parsed = path.parse(fileName);
  let candidate = path.join(uploadDir, fileName);
  let counter = 1;

  while (true) {
    try {
      await fsp.access(candidate);
      const nextName = `${parsed.name} (${counter})${parsed.ext}`;
      candidate = path.join(uploadDir, nextName);
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

function formatPublicTransfer(transfer) {
  const elapsedSeconds = Math.max(0.001, (Date.now() - transfer.startedAt) / 1000);
  const speed = transfer.received / elapsedSeconds;
  const remaining = Math.max(0, transfer.size - transfer.received);
  const eta = transfer.size > 0 && speed > 0 ? remaining / speed : null;
  const percent = transfer.size > 0 ? Math.min(100, (transfer.received / transfer.size) * 100) : null;

  return {
    id: transfer.id,
    fileName: transfer.fileName,
    savedName: transfer.savedName,
    size: transfer.size,
    received: transfer.received,
    status: transfer.status,
    error: transfer.error,
    percent,
    speed,
    eta,
    startedAt: transfer.startedAt
  };
}

function publicHistoryItem(item) {
  return {
    id: item.id,
    fileName: item.fileName,
    savedName: item.savedName,
    size: item.size,
    duration: item.duration,
    completedAt: item.completedAt,
    location: item.location,
    downloadUrl: item.downloadUrl
  };
}

function publicState(session) {
  return {
    active: Array.from(session.activeTransfers.values()).map(formatPublicTransfer),
    history: session.history.slice(0, 12).map(publicHistoryItem)
  };
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function isLocalRequest(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const remoteAddress = req.socket.remoteAddress || "";
  const normalized = remoteAddress.replace(/^::ffff:/, "");

  const localAddress = normalized === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "localhost";
  return localAddress && isLoopbackHost(host);
}

function requireLocalRequest(req, res) {
  if (isLocalRequest(req)) return true;

  writeJson(res, 403, {
    ok: false,
    error: "Esta acao so pode ser feita no computador que esta rodando o app."
  });
  return false;
}

function readJsonBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Corpo da requisicao muito grande"));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON invalido"));
      }
    });

    req.on("error", reject);
  });
}

async function listDriveRoots() {
  if (process.platform !== "win32") {
    return [{ name: "/", path: "/" }, { name: os.homedir(), path: os.homedir() }];
  }

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const checks = await Promise.all(
    letters.map(async (letter) => {
      const rootPath = `${letter}:\\`;
      try {
        await fsp.access(rootPath);
        return { name: rootPath, path: rootPath };
      } catch {
        return null;
      }
    })
  );

  return checks.filter(Boolean);
}

async function listFolders(folderPath) {
  if (!folderPath) {
    return {
      current: null,
      parent: null,
      roots: await listDriveRoots(),
      folders: []
    };
  }

  const current = path.resolve(folderPath);
  const stat = await fsp.stat(current);
  if (!stat.isDirectory()) throw new Error("O caminho informado nao e uma pasta");

  const root = path.parse(current).root;
  const entries = await fsp.readdir(current, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(current, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));

  return {
    current,
    parent: current === root ? null : path.dirname(current),
    roots: await listDriveRoots(),
    folders
  };
}

async function handleDestination(req, res) {
  if (!requireLocalRequest(req, res)) return;

  if (req.method === "GET") {
    writeJson(res, 200, {
      ok: true,
      destinationDir: uploadDir,
      defaultDir: DEFAULT_UPLOAD_DIR
    });
    return;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const rawDestination = String(body.destinationDir || "").trim();

    if (!rawDestination) throw new Error("Informe uma pasta valida");

    const destinationDir = path.resolve(rawDestination);

    await fsp.mkdir(destinationDir, { recursive: true });
    const stat = await fsp.stat(destinationDir);
    if (!stat.isDirectory()) throw new Error("O caminho informado nao e uma pasta");

    uploadDir = destinationDir;
    await saveSettings();

    writeJson(res, 200, {
      ok: true,
      destinationDir: uploadDir
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel salvar a pasta"
    });
  }
}

async function handleFolders(req, res, url) {
  if (!requireLocalRequest(req, res)) return;

  try {
    writeJson(res, 200, {
      ok: true,
      ...(await listFolders(url.searchParams.get("path")))
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel abrir esta pasta"
    });
  }
}

function sendSseState(res, session) {
  res.write(`event: state\ndata: ${JSON.stringify(publicState(session))}\n\n`);
}

function broadcastState(session) {
  const payload = `event: state\ndata: ${JSON.stringify(publicState(session))}\n\n`;

  for (const client of sseClients) {
    if (client.sessionId === session.id) {
      client.res.write(payload);
    }
  }
}

function serveText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}

function contentDisposition(fileName) {
  const fallback = sanitizeFileName(fileName).replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function isHostedEnvironment() {
  return Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
}

function uploadLocationLabel(targetPath) {
  if (isHostedEnvironment()) {
    return "Servidor temporario - use o botao de download";
  }

  return targetPath;
}

function safeUploadId(value) {
  const id = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return id || crypto.randomUUID();
}

function partialUploadPath(session, id) {
  return path.join(uploadDir, `.upload-${safeSessionId(session.id)}-${safeUploadId(id)}.part`);
}

function uploadMetaPath(session, id) {
  return path.join(uploadDir, `.upload-${safeSessionId(session.id)}-${safeUploadId(id)}.json`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeUploadFiles(session, id) {
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const results = await Promise.allSettled([
      fsp.rm(partialUploadPath(session, id), { force: true }),
      fsp.rm(uploadMetaPath(session, id), { force: true })
    ]);
    const failed = results.find((result) => result.status === "rejected");

    if (!failed) return;

    lastError = failed.reason;
    await wait(120 * (attempt + 1));
  }

  throw lastError;
}

async function readUploadMeta(session, id) {
  const raw = await fsp.readFile(uploadMetaPath(session, id), "utf8");
  return JSON.parse(raw);
}

async function writeUploadMeta(session, meta) {
  await fsp.writeFile(uploadMetaPath(session, meta.id), JSON.stringify(meta, null, 2));
}

function rememberCompletedUpload(session, { id, fileName, savedName, targetPath, size, duration, completedAt }) {
  const downloadToken = crypto.randomBytes(16).toString("hex");
  const downloadUrl = `/download?session=${encodeURIComponent(session.id)}&id=${encodeURIComponent(id)}&token=${downloadToken}`;

  session.completedFiles.set(id, {
    fileName,
    savedName,
    targetPath,
    size,
    downloadToken
  });

  session.history.unshift({
    id,
    fileName,
    savedName,
    size,
    duration,
    completedAt,
    location: uploadLocationLabel(targetPath),
    downloadUrl
  });
  session.history.splice(12);

  return downloadUrl;
}

async function serveStatic(res, filePath) {
  const normalized = path.normalize(filePath);
  const relative = path.relative(PUBLIC_DIR, normalized);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    serveText(res, 403, "Acesso negado");
    return;
  }

  try {
    const body = await fsp.readFile(normalized);
    const contentType = mimeTypes.get(path.extname(normalized).toLowerCase()) || "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": body.length,
      "cache-control": "no-store"
    });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      serveText(res, 404, "Arquivo nao encontrado");
      return;
    }
    serveText(res, 500, "Erro ao carregar arquivo");
  }
}

function validateKey(url) {
  return Boolean(sessionFromKey(url));
}

function requireUploadSession(req, res, url, { json = true } = {}) {
  const session = sessionFromKey(url);
  if (session) return session;

  if (json) {
    writeJson(res, 403, { ok: false, expired: true, error: EXPIRED_QR_MESSAGE });
  } else {
    serveText(res, 403, EXPIRED_QR_MESSAGE);
  }
  req.resume();
  return null;
}

async function handleUpload(req, res, url) {
  const session = requireUploadSession(req, res, url, { json: false });
  if (!session) return;

  if (req.method !== "POST") {
    serveText(res, 405, "Metodo nao permitido");
    req.resume();
    return;
  }

  const id = safeUploadId(url.searchParams.get("id") || crypto.randomUUID());
  const fileName = sanitizeFileName(req.headers["x-file-name"]);
  const size = Number(req.headers["content-length"] || 0);
  const targetPath = await uniqueUploadPath(fileName);
  const savedName = path.basename(targetPath);
  const transfer = {
    id,
    fileName,
    savedName,
    size,
    received: 0,
    status: "receiving",
    error: null,
    startedAt: Date.now()
  };

  session.activeTransfers.set(id, transfer);
  broadcastState(session);

  let lastBroadcast = 0;
  let finished = false;
  const output = fs.createWriteStream(targetPath, { flags: "wx" });

  function fail(message) {
    if (finished) return;
    finished = true;
    transfer.status = "error";
    transfer.error = message;
    broadcastState(session);
    output.destroy();
    fsp.unlink(targetPath).catch(() => {});
    if (!res.headersSent) serveText(res, 500, message);
    setTimeout(() => {
      session.activeTransfers.delete(id);
      broadcastState(session);
    }, 6000);
  }

  req.on("data", (chunk) => {
    transfer.received += chunk.length;
    const now = Date.now();
    if (now - lastBroadcast > 250) {
      lastBroadcast = now;
      broadcastState(session);
    }
  });

  req.on("aborted", () => fail("Envio cancelado"));
  req.on("error", () => fail("Erro ao receber arquivo"));
  output.on("error", () => fail("Erro ao salvar arquivo"));

  output.on("finish", () => {
    if (finished) return;
    finished = true;

    transfer.status = "complete";
    transfer.received = size || transfer.received;
    const completedAt = Date.now();
    const duration = Math.max(0.001, (completedAt - transfer.startedAt) / 1000);
    const downloadUrl = rememberCompletedUpload(session, {
      id,
      fileName,
      savedName,
      size: transfer.received,
      duration,
      completedAt,
      targetPath
    });

    writeJson(res, 200, {
      ok: true,
      fileName,
      savedName,
      size: transfer.received,
      duration,
      downloadUrl
    });
    broadcastState(session);

    setTimeout(() => {
      session.activeTransfers.delete(id);
      broadcastState(session);
    }, 5000);
  });

  req.pipe(output);
}

async function handleUploadStart(req, res, url) {
  const session = requireUploadSession(req, res, url);
  if (!session) return;

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  try {
    const body = await readJsonBody(req);
    const id = safeUploadId(body.id);
    const fileName = sanitizeFileName(body.fileName);
    const size = Math.max(0, Number(body.size || 0));
    const existing = session.completedFiles.get(id);

    if (existing) {
      writeJson(res, 200, {
        ok: true,
        id,
        complete: true,
        received: size,
        chunkSize: CHUNK_SIZE
      });
      return;
    }

    await fsp.mkdir(uploadDir, { recursive: true });

    let meta = null;
    try {
      meta = await readUploadMeta(session, id);
    } catch {
      meta = null;
    }

    if (!meta || meta.size !== size || meta.fileName !== fileName) {
      meta = {
        id,
        sessionId: session.id,
        fileName,
        size,
        createdAt: Date.now(),
        startedAt: Date.now()
      };
      await writeUploadMeta(session, meta);
      await fsp.rm(partialUploadPath(session, id), { force: true });
    }

    const handle = await fsp.open(partialUploadPath(session, id), "a");
    await handle.close();

    const received = (await fsp.stat(partialUploadPath(session, id))).size;
    session.activeTransfers.set(id, {
      id,
      fileName,
      savedName: fileName,
      size,
      received,
      status: "receiving",
      error: null,
      startedAt: meta.startedAt || Date.now()
    });
    broadcastState(session);

    writeJson(res, 200, {
      ok: true,
      id,
      received,
      chunkSize: CHUNK_SIZE
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel iniciar o envio"
    });
  }
}

async function handleUploadStatus(req, res, url) {
  const session = requireUploadSession(req, res, url);
  if (!session) return;

  const id = safeUploadId(url.searchParams.get("id"));
  const complete = session.completedFiles.has(id);

  try {
    const meta = complete ? null : await readUploadMeta(session, id);
    const received = complete
      ? session.completedFiles.get(id).size || 0
      : (await fsp.stat(partialUploadPath(session, id))).size;

    writeJson(res, 200, {
      ok: true,
      id,
      complete,
      received,
      size: meta ? meta.size : received
    });
  } catch {
    writeJson(res, 200, {
      ok: true,
      id,
      complete: false,
      received: 0,
      size: 0
    });
  }
}

async function handleUploadCancel(req, res, url) {
  const session = requireUploadSession(req, res, url);
  if (!session) return;

  if (req.method !== "POST" && req.method !== "DELETE") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  try {
    const body = req.method === "POST" ? await readJsonBody(req) : {};
    const id = safeUploadId(body.id || url.searchParams.get("id"));

    await removeUploadFiles(session, id);

    session.activeTransfers.delete(id);
    broadcastState(session);

    writeJson(res, 200, {
      ok: true,
      id,
      cancelled: true
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel descartar o envio"
    });
  }
}

async function handleUploadChunk(req, res, url) {
  const session = requireUploadSession(req, res, url);
  if (!session) return;

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  const id = safeUploadId(url.searchParams.get("id"));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  let meta = null;
  try {
    meta = await readUploadMeta(session, id);
  } catch {
    writeJson(res, 404, { ok: false, error: "Envio nao iniciado", received: 0 });
    req.resume();
    return;
  }

  const partialPath = partialUploadPath(session, id);
  const currentSize = (await fsp.stat(partialPath).catch(() => ({ size: 0 }))).size;

  if (offset !== currentSize) {
    writeJson(res, 409, {
      ok: false,
      error: "Offset fora de sincronia",
      received: currentSize
    });
    req.resume();
    return;
  }

  const transfer = session.activeTransfers.get(id) || {
    id,
    fileName: meta.fileName,
    savedName: meta.fileName,
    size: meta.size,
    received: currentSize,
    status: "receiving",
    error: null,
    startedAt: meta.startedAt || Date.now()
  };
  transfer.status = "receiving";
  transfer.error = null;
  session.activeTransfers.set(id, transfer);

  let received = currentSize;
  let lastBroadcast = 0;
  let finished = false;
  const output = fs.createWriteStream(partialPath, { flags: "r+", start: currentSize });

  function fail(message) {
    if (finished) return;
    finished = true;
    transfer.status = "paused";
    transfer.error = message;
    broadcastState(session);
    output.destroy();
    if (!res.headersSent) {
      writeJson(res, 500, { ok: false, error: message, received });
    }
  }

  req.on("data", (chunk) => {
    received += chunk.length;
    transfer.received = Math.min(received, meta.size);
    if (received > meta.size) {
      fail("Arquivo maior que o esperado");
      req.destroy();
      return;
    }
    const now = Date.now();
    if (now - lastBroadcast > 250) {
      lastBroadcast = now;
      broadcastState(session);
    }
  });

  req.on("aborted", () => fail("Envio pausado"));
  req.on("error", () => fail("Erro de rede"));
  output.on("error", () => fail("Erro ao salvar parte do arquivo"));

  output.on("finish", () => {
    if (finished) return;
    finished = true;
    transfer.received = Math.min(received, meta.size);
    broadcastState(session);
    writeJson(res, 200, {
      ok: true,
      id,
      received: transfer.received
    });
  });

  req.pipe(output);
}

async function handleUploadFinish(req, res, url) {
  const session = requireUploadSession(req, res, url);
  if (!session) return;

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  try {
    const body = await readJsonBody(req);
    const id = safeUploadId(body.id || url.searchParams.get("id"));
    const meta = await readUploadMeta(session, id);
    const partialPath = partialUploadPath(session, id);
    const stat = await fsp.stat(partialPath);

    if (stat.size < meta.size) {
      writeJson(res, 409, {
        ok: false,
        error: "Arquivo ainda incompleto",
        received: stat.size
      });
      return;
    }

    const targetPath = await uniqueUploadPath(meta.fileName);
    await fsp.rename(partialPath, targetPath);
    await fsp.rm(uploadMetaPath(session, id), { force: true });

    const savedName = path.basename(targetPath);
    const completedAt = Date.now();
    const startedAt = meta.startedAt || meta.createdAt || completedAt;
    const duration = Math.max(0.001, (completedAt - startedAt) / 1000);
    const transfer = session.activeTransfers.get(id) || {
      id,
      fileName: meta.fileName,
      savedName,
      size: meta.size,
      received: stat.size,
      status: "complete",
      error: null,
      startedAt
    };

    transfer.savedName = savedName;
    transfer.received = stat.size;
    transfer.status = "complete";
    transfer.error = null;

    const downloadUrl = rememberCompletedUpload(session, {
      id,
      fileName: meta.fileName,
      savedName,
      targetPath,
      size: stat.size,
      duration,
      completedAt
    });

    session.activeTransfers.set(id, transfer);
    broadcastState(session);

    setTimeout(() => {
      session.activeTransfers.delete(id);
      broadcastState(session);
    }, 5000);

    writeJson(res, 200, {
      ok: true,
      id,
      fileName: meta.fileName,
      savedName,
      size: stat.size,
      duration,
      downloadUrl
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel finalizar o envio"
    });
  }
}

async function handleDownload(req, res, url) {
  if (req.method !== "GET") {
    serveText(res, 405, "Metodo nao permitido");
    return;
  }

  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  const session = sessions.get(safeSessionId(url.searchParams.get("session")));
  const file = session?.completedFiles.get(id);

  if (!file || file.downloadToken !== token) {
    serveText(res, 404, "Arquivo nao encontrado");
    return;
  }

  try {
    const stat = await fsp.stat(file.targetPath);
    if (!stat.isFile()) throw new Error("Arquivo indisponivel");

    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": stat.size,
      "content-disposition": contentDisposition(file.savedName),
      "cache-control": "no-store"
    });

    fs.createReadStream(file.targetPath).pipe(res);
  } catch {
    serveText(res, 404, "Arquivo indisponivel");
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/") {
    await serveStatic(res, path.join(PUBLIC_DIR, "index.html"));
    return;
  }

  if (url.pathname === "/send") {
    if (!validateKey(url)) {
      await serveStatic(res, path.join(PUBLIC_DIR, "expired.html"));
      return;
    }
    await serveStatic(res, path.join(PUBLIC_DIR, "send.html"));
    return;
  }

  if (url.pathname === "/api/config") {
    const isLocal = isLocalRequest(req);
    const session = getOrCreateSession(url.searchParams.get("session"));
    const config = await getConfig(req, session);

    writeJson(res, 200, {
      ...config,
      addresses: isLocal ? config.addresses : [],
      canChooseDestination: isLocal
    });
    return;
  }

  if (url.pathname === "/api/state") {
    const session = getOrCreateSession(url.searchParams.get("session"));
    writeJson(res, 200, publicState(session));
    return;
  }

  if (url.pathname === "/api/destination") {
    await handleDestination(req, res);
    return;
  }

  if (url.pathname === "/api/folders") {
    await handleFolders(req, res, url);
    return;
  }

  if (url.pathname === "/events") {
    const session = getOrCreateSession(url.searchParams.get("session"));
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    const client = { res, sessionId: session.id };
    sseClients.add(client);
    sendSseState(res, session);
    req.on("close", () => sseClients.delete(client));
    return;
  }

  if (url.pathname === "/upload") {
    await handleUpload(req, res, url);
    return;
  }

  if (url.pathname === "/upload/start") {
    await handleUploadStart(req, res, url);
    return;
  }

  if (url.pathname === "/upload/status") {
    await handleUploadStatus(req, res, url);
    return;
  }

  if (url.pathname === "/upload/cancel") {
    await handleUploadCancel(req, res, url);
    return;
  }

  if (url.pathname === "/upload/chunk") {
    await handleUploadChunk(req, res, url);
    return;
  }

  if (url.pathname === "/upload/finish") {
    await handleUploadFinish(req, res, url);
    return;
  }

  if (url.pathname === "/download") {
    await handleDownload(req, res, url);
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    const assetPath = path.join(PUBLIC_DIR, url.pathname.replace(/^\/assets\//, ""));
    await serveStatic(res, assetPath);
    return;
  }

  serveText(res, 404, "Nao encontrado");
}

async function main() {
  await loadSettings();
  await fsp.mkdir(uploadDir, { recursive: true });

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) serveText(res, 500, "Erro interno");
    });
  });

  server.listen(PORT, HOST, async () => {
    const addresses = getLanAddresses();

    console.log("");
    console.log("Transferencia por QR Code");
    console.log(`Computador: http://localhost:${PORT}`);
    console.log("Abra o painel no computador para gerar um QR Code exclusivo desta sessao.");
    for (const item of addresses) {
      console.log(`Rede ${item.name}: ${item.url}`);
    }
    console.log("");
    console.log("Arquivos recebidos serao salvos em:");
    console.log(uploadDir);
    console.log("");
  });
}

setInterval(cleanupSessions, 60 * 60 * 1000).unref();

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
