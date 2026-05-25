const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const TOKEN = crypto.randomBytes(16).toString("hex");
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_UPLOAD_DIR = path.join(ROOT, "recebidos");
const SETTINGS_FILE = path.join(ROOT, "transferencia-config.json");

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
const activeTransfers = new Map();
const completedFiles = new Map();
const history = [];
let cachedConfig = null;
let uploadDir = DEFAULT_UPLOAD_DIR;

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

function mobileUrl() {
  const [first] = getLanAddresses();
  const host = first ? first.address : "localhost";
  return `http://${host}:${PORT}/send?key=${TOKEN}`;
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

function sendUrlForRequest(req) {
  const origin = requestOrigin(req);
  const host = String(req?.headers?.host || "").split(",")[0].trim();

  if (!origin || isLoopbackHost(host)) {
    return mobileUrl();
  }

  return `${origin}/send?key=${TOKEN}`;
}

async function getConfig(req) {
  const addresses = getLanAddresses();
  const sendUrl = sendUrlForRequest(req);

  if (cachedConfig && cachedConfig.sendUrl === sendUrl) {
    return {
      ...cachedConfig,
      addresses: addresses.map((item) => ({
        name: item.name,
        address: item.address,
        url: `${item.url}/send?key=${TOKEN}`
      }))
    };
  }

  cachedConfig = {
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
      url: `${item.url}/send?key=${TOKEN}`
    }))
  };

  return cachedConfig;
}

async function loadSettings() {
  try {
    const raw = await fsp.readFile(SETTINGS_FILE, "utf8");
    const settings = JSON.parse(raw);

    if (typeof settings.destinationDir === "string" && settings.destinationDir.trim()) {
      uploadDir = path.resolve(settings.destinationDir);
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
      candidate = path.join(UPLOAD_DIR, nextName);
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
    path: item.path,
    downloadUrl: item.downloadUrl
  };
}

function publicState() {
  return {
    active: Array.from(activeTransfers.values()).map(formatPublicTransfer),
    history: history.slice(0, 12).map(publicHistoryItem)
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
  const remoteAddress = req.socket.remoteAddress || "";
  const normalized = remoteAddress.replace(/^::ffff:/, "");

  return normalized === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "localhost";
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

function sendSseState(res) {
  res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
}

function broadcastState() {
  const payload = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
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
  return url.searchParams.get("key") === TOKEN;
}

async function handleUpload(req, res, url) {
  if (!validateKey(url)) {
    serveText(res, 403, "Chave invalida");
    req.resume();
    return;
  }

  if (req.method !== "POST") {
    serveText(res, 405, "Metodo nao permitido");
    req.resume();
    return;
  }

  const id = url.searchParams.get("id") || crypto.randomUUID();
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

  activeTransfers.set(id, transfer);
  broadcastState();

  let lastBroadcast = 0;
  let finished = false;
  const output = fs.createWriteStream(targetPath, { flags: "wx" });

  function fail(message) {
    if (finished) return;
    finished = true;
    transfer.status = "error";
    transfer.error = message;
    broadcastState();
    output.destroy();
    fsp.unlink(targetPath).catch(() => {});
    if (!res.headersSent) serveText(res, 500, message);
    setTimeout(() => {
      activeTransfers.delete(id);
      broadcastState();
    }, 6000);
  }

  req.on("data", (chunk) => {
    transfer.received += chunk.length;
    const now = Date.now();
    if (now - lastBroadcast > 250) {
      lastBroadcast = now;
      broadcastState();
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
    const downloadToken = crypto.randomBytes(16).toString("hex");
    const downloadUrl = `/download?id=${encodeURIComponent(id)}&token=${downloadToken}`;

    completedFiles.set(id, {
      fileName,
      savedName,
      targetPath,
      downloadToken
    });

    history.unshift({
      id,
      fileName,
      savedName,
      size: transfer.received,
      duration,
      completedAt,
      path: targetPath,
      downloadUrl
    });
    history.splice(12);

    writeJson(res, 200, {
      ok: true,
      fileName,
      savedName,
      size: transfer.received,
      duration
    });
    broadcastState();

    setTimeout(() => {
      activeTransfers.delete(id);
      broadcastState();
    }, 5000);
  });

  req.pipe(output);
}

async function handleDownload(req, res, url) {
  if (req.method !== "GET") {
    serveText(res, 405, "Metodo nao permitido");
    return;
  }

  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  const file = completedFiles.get(id);

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
      serveText(res, 403, "QR Code expirado ou invalido.", "text/html; charset=utf-8");
      return;
    }
    await serveStatic(res, path.join(PUBLIC_DIR, "send.html"));
    return;
  }

  if (url.pathname === "/api/config") {
    writeJson(res, 200, {
      ...(await getConfig(req)),
      canChooseDestination: isLocalRequest(req)
    });
    return;
  }

  if (url.pathname === "/api/state") {
    writeJson(res, 200, publicState());
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
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    sseClients.add(res);
    sendSseState(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (url.pathname === "/upload") {
    await handleUpload(req, res, url);
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
    const config = await getConfig();
    const addresses = getLanAddresses();

    console.log("");
    console.log("Transferencia por QR Code");
    console.log(`Computador: http://localhost:${PORT}`);
    console.log(`Celular:    ${config.sendUrl}`);
    for (const item of addresses.slice(1)) {
      console.log(`Alternativo ${item.name}: ${item.url}/send?key=${TOKEN}`);
    }
    console.log("");
    console.log("Arquivos recebidos serao salvos em:");
    console.log(uploadDir);
    console.log("");
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
