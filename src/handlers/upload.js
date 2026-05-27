const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const path = require("path");
const { safeUploadId, normalizeUploadId, imagePreviewContentType, detectPreviewType } = require("../uploads");

function createUploadHandlers({
  writeJson,
  serveText,
  broadcastState,
  getOrCreateSession,
  requireUploadSession,
  sessionByKey,
  sessions,
  uploadDir,
  CHUNK_SIZE,
  uniqueUploadPath,
  relativeDisplayPath,
  rememberCompletedUpload,
  formatPublicTransfer,
  publicState,
  uploadPartialPath,
  uploadMetaPath,
  readUploadMeta,
  writeUploadMeta,
  removeUploadFiles,
  readJsonBody,
  sanitizeRelativeFilePath
}) {
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
        await fsp.rm(uploadPartialPath(session, id), { force: true });
      }

      const handle = await fsp.open(uploadPartialPath(session, id), "a");
      await handle.close();

      const received = (await fsp.stat(uploadPartialPath(session, id))).size;
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
        error: `Nao foi possivel iniciar o envio: ${error.message || "erro desconhecido"}`
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
        : (await fsp.stat(uploadPartialPath(session, id))).size;

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

    const partialPath = uploadPartialPath(session, id);
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
      const partialPath = uploadPartialPath(session, id);
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
        error: `Nao foi possivel finalizar o envio de "${meta?.fileName || "arquivo"}": ${error.message || "erro desconhecido"}`
      });
    }
  }

  return {
    handleUpload,
    handleUploadStart,
    handleUploadStatus,
    handleUploadCancel,
    handleUploadChunk,
    handleUploadFinish
  };
}

module.exports = { createUploadHandlers };
