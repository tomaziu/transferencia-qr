const { EXPIRED_QR_MESSAGE, PIN_REQUIRED_MESSAGE } = require("./constants");

function createNoteHandlers({ writeJson, readJsonBody, sessionFromKeyOrId, sessionByKey, broadcastState, publicState, touchSession }) {
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
      const body = await readJsonBody(req, 1024 * 1024);
      const text = String(body.text || "");

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
        error: `Nao foi possivel salvar a anotacao: ${error.message || "erro desconhecido"}`
      });
    }
  }

  return { handleNote };
}

module.exports = { createNoteHandlers };
