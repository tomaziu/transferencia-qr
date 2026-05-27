const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { createRoute } = require("./src/routes");
const { deviceLabelFromUserAgent, publicMobilePresence } = require("./src/sessions");
const { createShareHelpers } = require("./src/share");
const { imagePreviewContentType, normalizeUploadId, safeUploadId } = require("./src/uploads");
const { sendZip } = require("./src/zip");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_UPLOAD_DIR = path.join(ROOT, "recebidos");
const SETTINGS_FILE = path.join(ROOT, "transferencia-config.json");
const CHUNK_SIZE = 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const NOTE_MAX_LENGTH = 20000;
const MOBILE_AUTH_TTL_MS = SESSION_TTL_MS;
const PIN_DIGITS = 6;

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
const PIN_REQUIRED_MESSAGE = "Digite o PIN mostrado no computador para continuar.";

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

function createSessionPin() {
  const max = 10 ** PIN_DIGITS;
  return String(crypto.randomInt(0, max)).padStart(PIN_DIGITS, "0");
}

function createMobileAuthToken() {
  return crypto.randomBytes(24).toString("hex");
}

function safeSessionId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function createSession(id = createSessionId()) {
  const session = {
    id: safeSessionId(id) || createSessionId(),
    key: createSessionKey(),
    pin: createSessionPin(),
    mobileAuthTokens: new Map(),
    mobileClients: new Map(),
    activeTransfers: new Map(),
    completedFiles: new Map(),
    sharedFiles: new Map(),
    shareBundles: new Map(),
    noteText: "",
    noteUpdatedAt: Date.now(),
    history: [],
    configCache: null,
    pinEnabled: true,
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

function normalizeMobileAuthToken(value) {
  return String(value || "").replace(/[^a-fA-F0-9]/g, "").slice(0, 64);
}

function mobileAuthTokenFromRequest(req, url) {
  const header = req.headers["x-mobile-auth"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  return normalizeMobileAuthToken(url.searchParams.get("auth") || headerValue);
}

function sessionByKey(url) {
  const key = String(url.searchParams.get("key") || "");
  if (!key) return null;

  for (const session of sessions.values()) {
    if (session.key === key) return session;
  }

  return null;
}

function hasValidMobileAuth(session, token) {
  const safeToken = normalizeMobileAuthToken(token);
  const auth = safeToken ? session.mobileAuthTokens.get(safeToken) : null;

  if (!auth) return false;

  if (Date.now() - auth.createdAt > MOBILE_AUTH_TTL_MS) {
    session.mobileAuthTokens.delete(safeToken);
    return false;
  }

  auth.lastSeen = Date.now();
  return true;
}

function sessionFromKey(req, url, { requireAuth = false } = {}) {
  const session = sessionByKey(url);
  if (!session) return null;

  if (requireAuth && !hasValidMobileAuth(session, mobileAuthTokenFromRequest(req, url))) {
    return null;
  }

  return touchSession(session);
}

function sessionFromKeyOrId(req, url, { requireMobileAuth = false } = {}) {
  if (url.searchParams.has("key")) {
    return sessionFromKey(req, url, { requireAuth: requireMobileAuth });
  }

  return getOrCreateSession(url.searchParams.get("session"));
}

function cleanupSessions() {
  const now = Date.now();

  for (const [id, session] of sessions) {
    for (const [token, auth] of session.mobileAuthTokens) {
      if (now - auth.createdAt > MOBILE_AUTH_TTL_MS) {
        session.mobileAuthTokens.delete(token);
      }
    }

    if (session.activeTransfers.size > 0) continue;
    if (now - session.updatedAt > SESSION_TTL_MS) {
      for (const file of session.sharedFiles.values()) {
        fsp.rm(file.targetPath, { force: true }).catch(() => {});
      }
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

function publicBaseUrlForRequest(req) {
  const origin = requestOrigin(req);
  const host = String(req?.headers?.host || "").split(",")[0].trim();

  if (!origin || isLoopbackHost(host)) {
    const [first] = getLanAddresses();
    const hostname = first ? first.address : "localhost";
    return `http://${hostname}:${PORT}`;
  }

  return origin;
}

function shareUrlForRequest(req, session, file) {
  const params = new URLSearchParams({
    session: session.id,
    id: file.id,
    token: file.downloadToken
  });

  return `${publicBaseUrlForRequest(req)}/share?${params.toString()}`;
}

function shareBundleUrlForRequest(req, session, bundle) {
  const params = new URLSearchParams({
    session: session.id,
    bundle: bundle.id,
    token: bundle.token
  });

  return `${publicBaseUrlForRequest(req)}/share?${params.toString()}`;
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
    pin: session.pin,
    pinEnabled: session.pinEnabled,
    createdAt: session.createdAt,
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

function decodeFileName(value) {
  const encodedName = String(value || "arquivo").trim();

  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

function sanitizeFileName(value) {
  const rawName = decodeFileName(value);
  const baseName = path.basename(rawName).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  const cleaned = baseName.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 180) || "arquivo";
}

function sanitizeRelativeFilePath(value) {
  const rawName = decodeFileName(value).replace(/\\/g, "/");
  const segments = rawName
    .split("/")
    .map((segment) => segment.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, " ").trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => segment.slice(0, 180));

  if (!segments.length) return "arquivo";

  return segments.join("/");
}

function relativeDisplayPath(targetPath) {
  const relative = path.relative(uploadDir, targetPath).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") ? relative : path.basename(targetPath);
}

async function uniqueUploadPath(filePath) {
  await fsp.mkdir(uploadDir, { recursive: true });

  const safePath = sanitizeRelativeFilePath(filePath);
  const segments = safePath.split("/");
  const fileName = segments.pop() || "arquivo";
  const targetDir = path.join(uploadDir, ...segments);
  const parsed = path.parse(fileName);
  await fsp.mkdir(targetDir, { recursive: true });

  let candidate = path.join(targetDir, fileName);
  let counter = 1;

  while (true) {
    try {
      await fsp.access(candidate);
      const nextName = `${parsed.name} (${counter})${parsed.ext}`;
      candidate = path.join(targetDir, nextName);
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
    downloadUrl: item.downloadUrl,
    previewUrl: item.previewUrl || null
  };
}

function publicState(session) {
  return {
    active: Array.from(session.activeTransfers.values()).map(formatPublicTransfer),
    history: session.history.slice(0, 12).map(publicHistoryItem),
    mobile: publicMobilePresence(session),
    session: {
      id: session.id,
      createdAt: session.createdAt,
      pinEnabled: session.pinEnabled
    },
    note: {
      text: session.noteText || "",
      updatedAt: session.noteUpdatedAt || session.createdAt
    }
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

async function handleNote(req, res, url) {
  const session = sessionFromKeyOrId(req, url, { requireMobileAuth: true });
  if (!session) {
    const expired = url.searchParams.has("key") && !sessionByKey(url);
    writeJson(res, 403, {
      ok: false,
      expired,
      pinRequired: !expired && url.searchParams.has("key"),
      error: expired ? EXPIRED_QR_MESSAGE : PIN_REQUIRED_MESSAGE
    });
    req.resume();
    return;
  }

  if (req.method === "GET") {
    writeJson(res, 200, {
      ok: true,
      note: publicState(session).note
    });
    return;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  try {
    const body = await readJsonBody(req, 64 * 1024);
    const text = String(body.text || "").slice(0, NOTE_MAX_LENGTH);

    session.noteText = text;
    session.noteUpdatedAt = Date.now();
    touchSession(session);
    broadcastState(session);

    writeJson(res, 200, {
      ok: true,
      note: publicState(session).note
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel salvar a anotacao"
    });
  }
}

async function handlePinVerify(req, res, url) {
  const session = sessionByKey(url);
  if (!session) {
    writeJson(res, 403, { ok: false, expired: true, error: EXPIRED_QR_MESSAGE });
    req.resume();
    return;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  try {
    if (!session.pinEnabled) {
      const auth = createMobileAuthToken();
      session.mobileAuthTokens.set(auth, {
        createdAt: Date.now(),
        lastSeen: Date.now(),
        label: deviceLabelFromUserAgent(req.headers["user-agent"])
      });
      touchSession(session);
      writeJson(res, 200, { ok: true, auth, pinEnabled: false, note: publicState(session).note });
      return;
    }

    const body = await readJsonBody(req);
    const pin = String(body.pin || "").replace(/\D/g, "");

    if (pin !== session.pin) {
      writeJson(res, 403, { ok: false, error: "PIN incorreto. Confira o codigo no computador." });
      return;
    }

    const auth = createMobileAuthToken();
    session.mobileAuthTokens.set(auth, {
      createdAt: Date.now(),
      lastSeen: Date.now(),
      label: deviceLabelFromUserAgent(req.headers["user-agent"])
    });
    touchSession(session);

    writeJson(res, 200, {
      ok: true,
      auth,
      note: publicState(session).note
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel validar o PIN"
    });
  }
}

function handlePinStatus(req, res, url) {
  const session = sessionByKey(url);
  if (!session) {
    writeJson(res, 403, { ok: false, expired: true, error: EXPIRED_QR_MESSAGE });
    req.resume();
    return;
  }

  const verified = hasValidMobileAuth(session, mobileAuthTokenFromRequest(req, url));
  writeJson(res, 200, {
    ok: true,
    verified,
    pinEnabled: session.pinEnabled,
    note: verified ? publicState(session).note : null
  });
}

async function handleSessionRenew(req, res, url) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  const session = getOrCreateSession(url.searchParams.get("session"));
  renewSessionAccess(session);
  const config = await getConfig(req, session);
  broadcastState(session);

  writeJson(res, 200, {
    ok: true,
    ...config,
    state: publicState(session)
  });
}

async function handleSessionEnd(req, res, url) {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  const session = getOrCreateSession(url.searchParams.get("session"));
  disconnectMobileClients(session, "Sessao encerrada no computador. Escaneie um novo QR Code.");
  await clearSessionData(session, {
    clearNote: true,
    deleteReceivedFiles: isHostedEnvironment()
  });
  renewSessionAccess(session);
  const config = await getConfig(req, session);
  broadcastState(session);

  writeJson(res, 200, {
    ok: true,
    ...config,
    state: publicState(session)
  });
}

async function handleHistoryClear(req, res, url) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  const session = getOrCreateSession(url.searchParams.get("session"));
  await clearCompletedHistory(session, {
    deleteReceivedFiles: isHostedEnvironment()
  });
  broadcastState(session);

  writeJson(res, 200, {
    ok: true,
    state: publicState(session)
  });
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

function broadcastEvent(session, eventName, payload, filter = () => true) {
  const body = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of sseClients) {
    if (client.sessionId === session.id && filter(client)) {
      client.res.write(body);
    }
  }
}

function disconnectMobileClients(session, message) {
  broadcastEvent(
    session,
    "expired",
    { expired: true, error: message },
    (client) => client.role === "mobile"
  );

  for (const client of Array.from(sseClients)) {
    if (client.sessionId === session.id && client.role === "mobile") {
      client.res.end();
      sseClients.delete(client);
    }
  }

  session.mobileClients.clear();
}

async function handlePinToggle(req, res, url) {
  if (!requireLocalRequest(req, res)) return;

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  const session = getOrCreateSession(url.searchParams.get("session"));
  session.pinEnabled = !session.pinEnabled;
  session.configCache = null;
  touchSession(session);

  if (session.pinEnabled) {
    renewSessionAccess(session);
  }

  const config = await getConfig(req, session);
  broadcastState(session);

  writeJson(res, 200, {
    ok: true,
    ...config,
    state: publicState(session)
  });
}

function renewSessionAccess(session) {
  disconnectMobileClients(session, "QR Code renovado. Escaneie o novo codigo no computador.");
  session.key = createSessionKey();
  session.pin = createSessionPin();
  session.mobileAuthTokens.clear();
  session.configCache = null;
  return touchSession(session);
}

function isHostedEnvironment() {
  return Boolean(
    process.env.RENDER ||
      process.env.RENDER_SERVICE_ID ||
      process.env.RENDER_EXTERNAL_URL ||
      process.env.RENDER_GIT_COMMIT
  );
}

async function removeSessionArtifacts(session, prefixKinds = ["upload", "share"]) {
  const safeId = safeSessionId(session.id);
  const prefixes = prefixKinds.map((kind) => `.${kind}-${safeId}-`);

  let entries = [];
  try {
    entries = await fsp.readdir(uploadDir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.allSettled(
    entries
      .filter((entry) => prefixes.some((prefix) => entry.name.startsWith(prefix)))
      .map((entry) => fsp.rm(path.join(uploadDir, entry.name), { force: true, recursive: entry.isDirectory() }))
  );
}

async function clearCompletedHistory(session, { deleteReceivedFiles = false } = {}) {
  const completed = Array.from(session.completedFiles.values());

  if (deleteReceivedFiles) {
    await Promise.allSettled(completed.map((file) => fsp.rm(file.targetPath, { force: true })));
  }

  session.completedFiles.clear();
  session.history = [];
  await removeSessionArtifacts(session, ["upload"]);
  touchSession(session);
}

async function clearSessionData(session, { clearNote = false, deleteReceivedFiles = false } = {}) {
  session.activeTransfers.clear();
  await clearCompletedHistory(session, { deleteReceivedFiles });

  await Promise.allSettled(
    Array.from(session.sharedFiles.values()).map((file) => removeShareFiles(session, file.id, file.targetPath))
  );
  session.sharedFiles.clear();
  session.shareBundles.clear();
  await removeSessionArtifacts(session, ["share"]);

  if (clearNote) {
    session.noteText = "";
    session.noteUpdatedAt = Date.now();
  }

  touchSession(session);
}

function serveText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}

function contentDisposition(fileName) {
  const safeName = sanitizeFileName(fileName);
  const fallback = safeName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function uploadLocationLabel(targetPath) {
  if (isHostedEnvironment()) {
    return "Servidor temporario - use o botao de download";
  }

  return targetPath;
}

function partialUploadPath(session, id) {
  return path.join(uploadDir, `.upload-${safeSessionId(session.id)}-${safeUploadId(id)}.part`);
}

function uploadMetaPath(session, id) {
  return path.join(uploadDir, `.upload-${safeSessionId(session.id)}-${safeUploadId(id)}.json`);
}

function sharePartialPath(session, id) {
  return path.join(uploadDir, `.share-${safeSessionId(session.id)}-${safeUploadId(id)}.part`);
}

function shareMetaPath(session, id) {
  return path.join(uploadDir, `.share-${safeSessionId(session.id)}-${safeUploadId(id)}.json`);
}

function shareStoredPath(session, id) {
  return path.join(uploadDir, `.share-${safeSessionId(session.id)}-${safeUploadId(id)}.file`);
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

async function removeShareFiles(session, id, targetPath = null) {
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const results = await Promise.allSettled([
      fsp.rm(sharePartialPath(session, id), { force: true }),
      fsp.rm(shareMetaPath(session, id), { force: true }),
      fsp.rm(targetPath || shareStoredPath(session, id), { force: true })
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

async function readShareMeta(session, id) {
  const raw = await fsp.readFile(shareMetaPath(session, id), "utf8");
  return JSON.parse(raw);
}

async function writeShareMeta(session, meta) {
  await fsp.writeFile(shareMetaPath(session, meta.id), JSON.stringify(meta, null, 2));
}

function removeSharedFileFromBundles(session, fileId) {
  for (const [bundleId, bundle] of session.shareBundles) {
    bundle.fileIds = bundle.fileIds.filter((id) => id !== fileId);
    if (bundle.fileIds.length === 0) {
      session.shareBundles.delete(bundleId);
    }
  }
}

function rememberCompletedUpload(session, { id, fileName, savedName, targetPath, size, duration, completedAt }) {
  const downloadToken = crypto.randomBytes(16).toString("hex");
  const downloadUrl = `/download?session=${encodeURIComponent(session.id)}&id=${encodeURIComponent(id)}&token=${downloadToken}`;
  const previewUrl = imagePreviewContentType(savedName || fileName)
    ? `${downloadUrl}&preview=1`
    : null;

  session.completedFiles.set(id, {
    fileName,
    savedName,
    targetPath,
    size,
    downloadToken,
    previewUrl
  });

  session.history.unshift({
    id,
    fileName,
    savedName,
    size,
    duration,
    completedAt,
    location: uploadLocationLabel(targetPath),
    downloadUrl,
    previewUrl
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
  return Boolean(sessionByKey(url));
}

function requireUploadSession(req, res, url, { json = true } = {}) {
  const session = sessionByKey(url);
  if (session && hasValidMobileAuth(session, mobileAuthTokenFromRequest(req, url))) {
    return touchSession(session);
  }

  if (json) {
    writeJson(res, 403, {
      ok: false,
      expired: !session,
      pinRequired: Boolean(session),
      error: session ? PIN_REQUIRED_MESSAGE : EXPIRED_QR_MESSAGE
    });
  } else {
    serveText(res, 403, session ? PIN_REQUIRED_MESSAGE : EXPIRED_QR_MESSAGE);
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
  const fileName = sanitizeRelativeFilePath(req.headers["x-file-name"]);
  const size = Number(req.headers["content-length"] || 0);
  const targetPath = await uniqueUploadPath(fileName);
  const savedName = relativeDisplayPath(targetPath);
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
    const fileName = sanitizeRelativeFilePath(body.fileName);
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

    const savedName = relativeDisplayPath(targetPath);
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

    const previewType = url.searchParams.get("preview") === "1"
      ? imagePreviewContentType(file.savedName || file.fileName)
      : null;

    res.writeHead(200, {
      "content-type": previewType || "application/octet-stream",
      "content-length": stat.size,
      "content-disposition": previewType ? "inline" : contentDisposition(file.savedName),
      "cache-control": "no-store"
    });

    fs.createReadStream(file.targetPath).pipe(res);
  } catch {
    serveText(res, 404, "Arquivo indisponivel");
  }
}

async function handleDownloadBundle(req, res, url) {
  if (req.method !== "GET") {
    serveText(res, 405, "Metodo nao permitido");
    return;
  }

  const session = sessions.get(safeSessionId(url.searchParams.get("session")));
  if (!session) {
    serveText(res, 404, "Sessao nao encontrada");
    return;
  }

  const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
  const tokens = (url.searchParams.get("tokens") || "").split(",").filter(Boolean);

  if (!ids.length || ids.length !== tokens.length) {
    serveText(res, 400, "Parametros invalidos");
    return;
  }

  const files = [];
  for (let i = 0; i < ids.length; i += 1) {
    const file = session.completedFiles.get(ids[i]);
    if (!file || file.downloadToken !== tokens[i]) {
      serveText(res, 404, "Um ou mais arquivos nao encontrados");
      return;
    }
    files.push({ fileName: file.savedName, targetPath: file.targetPath });
  }

  try {
    const zipName = files.length === 1 ? path.basename(files[0].fileName, path.extname(files[0].fileName)) + ".zip" : "arquivos-transferencia.zip";
    await sendZip(res, zipName, files);
  } catch (error) {
    if (!res.headersSent) {
      serveText(res, 500, error.message || "Erro ao gerar ZIP");
    }
  }
}

async function handleShareStart(req, res, url) {
  const session = getOrCreateSession(url.searchParams.get("session"));

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  try {
    const body = await readJsonBody(req);
    const id = safeUploadId(body.id);
    const fileName = sanitizeRelativeFilePath(body.fileName);
    const size = Math.max(0, Number(body.size || 0));
    const meta = {
      id,
      sessionId: session.id,
      fileName,
      size,
      downloadToken: crypto.randomBytes(18).toString("hex"),
      createdAt: Date.now(),
      startedAt: Date.now()
    };

    await fsp.mkdir(uploadDir, { recursive: true });
    await removeShareFiles(session, id, session.sharedFiles.get(id)?.targetPath);
    session.sharedFiles.delete(id);
    removeSharedFileFromBundles(session, id);
    await writeShareMeta(session, meta);

    const handle = await fsp.open(sharePartialPath(session, id), "a");
    await handle.close();

    writeJson(res, 200, {
      ok: true,
      id,
      received: 0,
      chunkSize: CHUNK_SIZE
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel preparar o arquivo"
    });
  }
}

async function handleShareStatus(req, res, url) {
  const session = getOrCreateSession(url.searchParams.get("session"));
  const id = safeUploadId(url.searchParams.get("id"));
  const shared = session.sharedFiles.get(id);

  if (shared) {
    writeJson(res, 200, {
      ok: true,
      id,
      complete: true,
      received: shared.size,
      size: shared.size
    });
    return;
  }

  try {
    const meta = await readShareMeta(session, id);
    const received = (await fsp.stat(sharePartialPath(session, id))).size;

    writeJson(res, 200, {
      ok: true,
      id,
      complete: false,
      received,
      size: meta.size
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

async function handleShareChunk(req, res, url) {
  const session = getOrCreateSession(url.searchParams.get("session"));

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  const id = safeUploadId(url.searchParams.get("id"));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  let meta = null;
  try {
    meta = await readShareMeta(session, id);
  } catch {
    writeJson(res, 404, { ok: false, error: "Compartilhamento nao iniciado", received: 0 });
    req.resume();
    return;
  }

  const partialPath = sharePartialPath(session, id);
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

  let received = currentSize;
  let finished = false;
  const output = fs.createWriteStream(partialPath, { flags: "r+", start: currentSize });

  function fail(message) {
    if (finished) return;
    finished = true;
    output.destroy();
    if (!res.headersSent) {
      writeJson(res, 500, { ok: false, error: message, received });
    }
  }

  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > meta.size) {
      fail("Arquivo maior que o esperado");
      req.destroy();
    }
  });

  req.on("aborted", () => fail("Envio pausado"));
  req.on("error", () => fail("Erro de rede"));
  output.on("error", () => fail("Erro ao salvar parte do arquivo"));

  output.on("finish", () => {
    if (finished) return;
    finished = true;
    writeJson(res, 200, {
      ok: true,
      id,
      received: Math.min(received, meta.size)
    });
  });

  req.pipe(output);
}

async function handleShareFinish(req, res, url) {
  const session = getOrCreateSession(url.searchParams.get("session"));

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  try {
    const body = await readJsonBody(req);
    const id = safeUploadId(body.id || url.searchParams.get("id"));
    const meta = await readShareMeta(session, id);
    const partialPath = sharePartialPath(session, id);
    const stat = await fsp.stat(partialPath);

    if (stat.size < meta.size) {
      writeJson(res, 409, {
        ok: false,
        error: "Arquivo ainda incompleto",
        received: stat.size
      });
      return;
    }

    const targetPath = shareStoredPath(session, id);
    await fsp.rm(targetPath, { force: true });
    await fsp.rename(partialPath, targetPath);
    await fsp.rm(shareMetaPath(session, id), { force: true });

    const sharedFile = {
      id,
      fileName: meta.fileName,
      savedName: meta.fileName,
      targetPath,
      size: stat.size,
      downloadToken: meta.downloadToken,
      createdAt: meta.createdAt || Date.now()
    };
    const shareUrl = shareUrlForRequest(req, session, sharedFile);
    const qrCode = await QRCode.toDataURL(shareUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 8,
      color: {
        dark: "#102030",
        light: "#ffffff"
      }
    });

    session.sharedFiles.set(id, sharedFile);

    writeJson(res, 200, {
      ok: true,
      id,
      fileName: sharedFile.fileName,
      size: sharedFile.size,
      shareUrl,
      qrCode
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel gerar o download"
    });
  }
}

async function handleShareBundle(req, res, url) {
  const session = getOrCreateSession(url.searchParams.get("session"));

  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  try {
    const body = await readJsonBody(req);
    const ids = Array.isArray(body.ids)
      ? body.ids.map(normalizeUploadId).filter(Boolean)
      : [];

    if (ids.length === 0) {
      writeJson(res, 400, { ok: false, error: "Nenhum arquivo informado" });
      return;
    }

    const files = ids.map((id) => session.sharedFiles.get(id));
    if (files.some((file) => !file)) {
      writeJson(res, 404, { ok: false, error: "Um ou mais arquivos nao estao disponiveis" });
      return;
    }

    const bundle = {
      id: crypto.randomBytes(12).toString("hex"),
      token: crypto.randomBytes(18).toString("hex"),
      fileIds: ids,
      createdAt: Date.now()
    };
    const shareUrl = shareBundleUrlForRequest(req, session, bundle);
    const qrCode = await QRCode.toDataURL(shareUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 8,
      color: {
        dark: "#102030",
        light: "#ffffff"
      }
    });

    session.shareBundles.set(bundle.id, bundle);

    writeJson(res, 200, {
      ok: true,
      mode: "bundle",
      bundleId: bundle.id,
      fileName: `${files.length} arquivos`,
      size: files.reduce((total, file) => total + file.size, 0),
      totalSize: files.reduce((total, file) => total + file.size, 0),
      fileCount: files.length,
      files: files.map((file) => shareFileInfo(session, file)),
      zipDownloadUrl: shareBundleDownloadUrl(session, bundle),
      shareUrl,
      qrCode
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel gerar o pacote de arquivos"
    });
  }
}

async function handleShareCancel(req, res, url) {
  const session = getOrCreateSession(url.searchParams.get("session"));

  if (req.method !== "POST" && req.method !== "DELETE") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    req.resume();
    return;
  }

  try {
    const body = req.method === "POST" ? await readJsonBody(req) : {};
    const id = safeUploadId(body.id || url.searchParams.get("id"));
    const shared = session.sharedFiles.get(id);

    await removeShareFiles(session, id, shared?.targetPath);
    session.sharedFiles.delete(id);
    removeSharedFileFromBundles(session, id);

    writeJson(res, 200, {
      ok: true,
      id,
      cancelled: true
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error.message || "Nao foi possivel cancelar o compartilhamento"
    });
  }
}

const { shareFileInfo, shareBundleDownloadUrl, shareBundleZipName } = createShareHelpers({ sanitizeFileName });

function getSharedFileFromUrl(url) {
  const session = sessions.get(safeSessionId(url.searchParams.get("session")));
  const id = normalizeUploadId(url.searchParams.get("id"));
  const token = String(url.searchParams.get("token") || "");
  const file = session?.sharedFiles.get(id);

  if (!session || !file || file.downloadToken !== token) return null;

  touchSession(session);
  return { session, file };
}

function getShareBundleFromUrl(url) {
  const session = sessions.get(safeSessionId(url.searchParams.get("session")));
  const id = normalizeUploadId(url.searchParams.get("bundle"));
  const token = String(url.searchParams.get("token") || "");
  const bundle = session?.shareBundles.get(id);

  if (!session || !bundle || bundle.token !== token) return null;

  const files = bundle.fileIds.map((fileId) => session.sharedFiles.get(fileId));
  if (files.some((file) => !file)) return null;

  touchSession(session);
  return { session, bundle, files };
}

async function handleShareInfo(req, res, url) {
  if (req.method !== "GET") {
    writeJson(res, 405, { ok: false, error: "Metodo nao permitido" });
    return;
  }

  if (url.searchParams.has("bundle")) {
    const bundleMatch = getShareBundleFromUrl(url);
    if (!bundleMatch) {
      writeJson(res, 404, { ok: false, error: "Arquivos indisponiveis ou link expirado" });
      return;
    }

    const { session, bundle, files } = bundleMatch;
    const totalSize = files.reduce((total, file) => total + file.size, 0);

    writeJson(res, 200, {
      ok: true,
      mode: "bundle",
      fileName: `${files.length} arquivos`,
      size: totalSize,
      totalSize,
      fileCount: files.length,
      createdAt: bundle.createdAt,
      zipDownloadUrl: shareBundleDownloadUrl(session, bundle),
      files: files.map((file) => shareFileInfo(session, file))
    });
    return;
  }

  const match = getSharedFileFromUrl(url);
  if (!match) {
    writeJson(res, 404, { ok: false, error: "Arquivo indisponivel ou link expirado" });
    return;
  }

  const { session, file } = match;
  const fileInfo = shareFileInfo(session, file);

  writeJson(res, 200, {
    ok: true,
    mode: "single",
    fileName: fileInfo.fileName,
    size: fileInfo.size,
    createdAt: fileInfo.createdAt,
    downloadUrl: fileInfo.downloadUrl,
    files: [fileInfo]
  });
}

async function handleShareBundleDownload(req, res, url) {
  if (req.method !== "GET") {
    serveText(res, 405, "Metodo nao permitido");
    return;
  }

  const match = getShareBundleFromUrl(url);
  if (!match) {
    serveText(res, 404, "Arquivos indisponiveis ou link expirado");
    return;
  }

  try {
    await sendZip(res, shareBundleZipName(match.files), match.files);
  } catch (error) {
    if (!res.headersSent) {
      serveText(res, 404, error.message || "Arquivos indisponiveis");
    } else {
      res.destroy(error);
    }
  }
}

async function handleShareDownload(req, res, url) {
  if (req.method !== "GET") {
    serveText(res, 405, "Metodo nao permitido");
    return;
  }

  const match = getSharedFileFromUrl(url);
  if (!match) {
    serveText(res, 404, "Arquivo indisponivel ou link expirado");
    return;
  }

  const { file } = match;

  try {
    const stat = await fsp.stat(file.targetPath);
    if (!stat.isFile()) throw new Error("Arquivo indisponivel");

    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": stat.size,
      "content-disposition": contentDisposition(file.fileName),
      "cache-control": "no-store"
    });

    fs.createReadStream(file.targetPath).pipe(res);
  } catch {
    serveText(res, 404, "Arquivo indisponivel");
  }
}

const route = createRoute({
  PUBLIC_DIR,
  sseClients,
  serveStatic,
  validateKey,
  isLocalRequest,
  getOrCreateSession,
  getConfig,
  writeJson,
  publicState,
  handleDestination,
  handleFolders,
  handleNote,
  handlePinVerify,
  handlePinStatus,
  handlePinToggle,
  handleSessionRenew,
  handleSessionEnd,
  handleHistoryClear,
  sessionFromKeyOrId,
  sessionByKey,
  EXPIRED_QR_MESSAGE,
  PIN_REQUIRED_MESSAGE,
  deviceLabelFromUserAgent,
  broadcastState,
  sendSseState,
  handleUpload,
  handleUploadStart,
  handleUploadStatus,
  handleUploadCancel,
  handleUploadChunk,
  handleUploadFinish,
  handleDownload,
  handleDownloadBundle,
  handleShareStart,
  handleShareStatus,
  handleShareChunk,
  handleShareFinish,
  handleShareBundle,
  handleShareCancel,
  handleShareInfo,
  handleShareDownload,
  handleShareBundleDownload,
  serveText
});

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
