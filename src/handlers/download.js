const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { imagePreviewContentType, mediaPreviewContentType } = require("../uploads");
const { sendZip } = require("../zip");

function createDownloadHandlers({ serveText, sessions, contentDisposition, safeSessionId }) {
  async function handleDownload(req, res, url) {
    if (req.method !== "GET") {
      serveText(res, 405, "Método não permitido");
      return;
    }

    const id = url.searchParams.get("id");
    const token = url.searchParams.get("token");
    const session = sessions.get(safeSessionId(url.searchParams.get("session")));
    const file = session?.completedFiles.get(id);

    if (!file || file.downloadToken !== token) {
      serveText(res, 404, "Arquivo não encontrado");
      return;
    }

    try {
      const stat = await fsp.stat(file.targetPath);
      if (!stat.isFile()) throw new Error("Arquivo indisponível");

      const previewType = url.searchParams.get("preview") === "1"
        ? (imagePreviewContentType(file.savedName || file.fileName) || mediaPreviewContentType(file.savedName || file.fileName))
        : null;

      res.writeHead(200, {
        "content-type": previewType || "application/octet-stream",
        "content-length": stat.size,
        "content-disposition": previewType ? "inline" : contentDisposition(file.savedName),
        "cache-control": "no-store"
      });

      fs.createReadStream(file.targetPath).pipe(res);
    } catch {
      serveText(res, 404, "Arquivo indisponível");
    }
  }

  async function handleDownloadBundle(req, res, url) {
    if (req.method !== "GET") {
      serveText(res, 405, "Método não permitido");
      return;
    }

    const session = sessions.get(safeSessionId(url.searchParams.get("session")));
    if (!session) {
      serveText(res, 404, "Sessão não encontrada");
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
        serveText(res, 404, "Um ou mais arquivos não encontrados");
        return;
      }
      files.push({ fileName: file.savedName, targetPath: file.targetPath });
    }

    try {
      const zipName = files.length === 1 ? path.basename(files[0].fileName, path.extname(files[0].fileName)) + ".zip" : "arquivos-transferência.zip";
      await sendZip(res, zipName, files);
    } catch (error) {
      if (!res.headersSent) {
        serveText(res, 500, error.message || "Erro ao gerar ZIP");
      }
    }
  }

  return { handleDownload, handleDownloadBundle };
}

module.exports = { createDownloadHandlers };
