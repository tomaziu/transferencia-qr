const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const QRCode = require("qrcode");
const { safeUploadId, normalizeUploadId } = require("../uploads");
const { sendZip } = require("../zip");

function createShareHandlers({
  writeJson,
  serveText,
  readJsonBody,
  getOrCreateSession,
  uploadDir,
  CHUNK_SIZE,
  touchSession,
  safeSessionId,
  sessions,
  sanitizeFileName,
  sanitizeRelativeFilePath,
  contentDisposition,
  sharePartialPath,
  shareMetaPath,
  shareStoredPath,
  readShareMeta,
  writeShareMeta,
  removeShareFiles,
  removeSharedFileFromBundles,
  shareFileInfo,
  shareBundleDownloadUrl,
  shareBundleZipName,
  shareUrlForRequest,
  shareBundleUrlForRequest
}) {
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

  async function handleShareStart(req, res, url) {
    const session = getOrCreateSession(url.searchParams.get("session"));

    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
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
        error: `Não foi possível preparar o arquivo: ${error.message || "erro desconhecido"}`
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
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
      req.resume();
      return;
    }

    const id = safeUploadId(url.searchParams.get("id"));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

    let meta = null;
    try {
      meta = await readShareMeta(session, id);
    } catch {
      writeJson(res, 404, { ok: false, error: "Compartilhamento não iniciado", received: 0 });
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
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
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
        error: `Não foi possível gerar o download de "${meta?.fileName || "arquivo"}": ${error.message || "erro desconhecido"}`
      });
    }
  }

  async function handleShareBundle(req, res, url) {
    const session = getOrCreateSession(url.searchParams.get("session"));

    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
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
        writeJson(res, 404, { ok: false, error: "Um ou mais arquivos não estão disponíveis" });
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
        error: `Não foi possível gerar o pacote de arquivos: ${error.message || "erro desconhecido"}`
      });
    }
  }

  async function handleShareCancel(req, res, url) {
    const session = getOrCreateSession(url.searchParams.get("session"));

    if (req.method !== "POST" && req.method !== "DELETE") {
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
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
        error: `Não foi possível cancelar o compartilhamento: ${error.message || "erro desconhecido"}`
      });
    }
  }

  async function handleShareInfo(req, res, url) {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
      return;
    }

    if (url.searchParams.has("bundle")) {
      const bundleMatch = getShareBundleFromUrl(url);
      if (!bundleMatch) {
        writeJson(res, 404, { ok: false, error: "Arquivos indisponíveis ou link expirado" });
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
      writeJson(res, 404, { ok: false, error: "Arquivo indisponível ou link expirado" });
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
      serveText(res, 405, "Método não permitido");
      return;
    }

    const match = getShareBundleFromUrl(url);
    if (!match) {
      serveText(res, 404, "Arquivos indisponíveis ou link expirado");
      return;
    }

    try {
      await sendZip(res, shareBundleZipName(match.files), match.files);
    } catch (error) {
      if (!res.headersSent) {
        serveText(res, 404, error.message || "Arquivos indisponíveis");
      } else {
        res.destroy(error);
      }
    }
  }

  async function handleShareDownload(req, res, url) {
    if (req.method !== "GET") {
      serveText(res, 405, "Método não permitido");
      return;
    }

    const match = getSharedFileFromUrl(url);
    if (!match) {
      serveText(res, 404, "Arquivo indisponível ou link expirado");
      return;
    }

    const { file } = match;

    try {
      const stat = await fsp.stat(file.targetPath);
      if (!stat.isFile()) throw new Error("Arquivo indisponível");

      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": stat.size,
        "content-disposition": contentDisposition(file.fileName),
        "cache-control": "no-store"
      });

      fs.createReadStream(file.targetPath).pipe(res);
    } catch {
      serveText(res, 404, "Arquivo indisponível");
    }
  }

  return {
    getSharedFileFromUrl,
    getShareBundleFromUrl,
    handleShareStart,
    handleShareStatus,
    handleShareChunk,
    handleShareFinish,
    handleShareBundle,
    handleShareCancel,
    handleShareInfo,
    handleShareBundleDownload,
    handleShareDownload
  };
}

module.exports = { createShareHandlers };
