const path = require("path");
const fsp = require("fs").promises;

function createAdminHandlers({ writeJson, readJsonBody, requireLocalRequest, uploadDir, DEFAULT_UPLOAD_DIR, saveSettings }) {
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

  async function listDriveRoots() {
    if (process.platform !== "win32") {
      return [{ name: "/", path: "/" }, { name: require("os").homedir(), path: require("os").homedir() }];
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

  return { handleDestination, handleFolders };
}

module.exports = { createAdminHandlers };
