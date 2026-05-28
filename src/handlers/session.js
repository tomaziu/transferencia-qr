const { EXPIRED_QR_MESSAGE, PIN_REQUIRED_MESSAGE } = require("./constants");

function createSessionHandlers({
  writeJson,
  readJsonBody,
  getOrCreateSession,
  sessionByKey,
  sessionFromKeyOrId,
  getConfig,
  broadcastState,
  sendSseState,
  renewSessionAccess,
  clearSessionData,
  clearCompletedHistory,
  isHostedEnvironment,
  disconnectMobileClients,
  deviceLabelFromUserAgent,
  publicState,
  requireLocalRequest,
  hasValidMobileAuth,
  mobileAuthTokenFromRequest,
  createMobileAuthToken,
  touchSession,
  broadcastEvent,
  sseClients
}) {
  async function handlePinVerify(req, res, url) {
    const session = sessionByKey(url);
    if (!session) {
      writeJson(res, 403, { ok: false, expired: true, error: EXPIRED_QR_MESSAGE });
      req.resume();
      return;
    }

    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
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
        writeJson(res, 403, { ok: false, error: "PIN incorreto. Confira o código no computador." });
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
        error: error.message || "Não foi possível validar o PIN"
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

  async function handlePinToggle(req, res, url) {
    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
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

  async function handleSessionRenew(req, res, url) {
    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
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
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
      req.resume();
      return;
    }

    const session = getOrCreateSession(url.searchParams.get("session"));
    disconnectMobileClients(session, "Sessão encerrada no computador. Escaneie um novo QR Code.");
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
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
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

  async function handleDisconnectMobile(req, res, url) {
    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, error: "Método não permitido" });
      req.resume();
      return;
    }

    try {
      const body = await readJsonBody(req);
      const clientId = String(body.clientId || "").trim();
      if (!clientId) {
        writeJson(res, 400, { ok: false, error: "Informe o ID do aparelho" });
        return;
      }

      const session = getOrCreateSession(url.searchParams.get("session"));
      const client = session.mobileClients.get(clientId);

      if (!client) {
        writeJson(res, 404, { ok: false, error: "Aparelho não encontrado" });
        return;
      }

      const authToken = String(client.authToken || "");
      const matchesClient = (connection) =>
        connection.role === "mobile" &&
        (connection.mobileClientId === clientId || (authToken && connection.authToken === authToken));

      broadcastEvent(
        session,
        "expired",
        { expired: true, error: "Sessão removida pelo computador." },
        matchesClient
      );

      for (const connection of Array.from(sseClients)) {
        if (connection.sessionId === session.id && matchesClient(connection)) {
          connection.res.end();
          sseClients.delete(connection);
        }
      }

      if (authToken) {
        session.mobileAuthTokens.delete(authToken);
      }

      session.mobileClients.delete(clientId);
      if (authToken) {
        for (const [id, entry] of session.mobileClients) {
          if (entry.authToken === authToken) {
            session.mobileClients.delete(id);
          }
        }
      }

      touchSession(session);
      broadcastState(session);

      writeJson(res, 200, { ok: true, state: publicState(session) });
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error.message || "Não foi possível remover o aparelho"
      });
    }
  }

  return {
    handlePinVerify,
    handlePinStatus,
    handlePinToggle,
    handleSessionRenew,
    handleSessionEnd,
    handleHistoryClear,
    handleDisconnectMobile
  };
}

module.exports = { createSessionHandlers };
