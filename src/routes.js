const crypto = require("crypto");
const path = require("path");
const { isMobileUserAgent } = require("./mobile-detect");

function createRoute({
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
  handleDisconnectMobile,
  mobileAuthTokenFromRequest,
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
}) {
  return async function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/") {
      const key = url.searchParams.get("key");
      if (key) {
        res.writeHead(302, {
          location: `/send?key=${encodeURIComponent(key)}`
        });
        res.end();
        return;
      }

      const forceDesktop = url.searchParams.get("desktop") === "1";
      if (!forceDesktop && isMobileUserAgent(req)) {
        await serveStatic(res, path.join(PUBLIC_DIR, "mobile.html"));
        return;
      }

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

    if (url.pathname === "/share") {
      await serveStatic(res, path.join(PUBLIC_DIR, "share.html"));
      return;
    }

    if (url.pathname === "/api/config") {
      const isLocal = isLocalRequest(req);
      const session = getOrCreateSession(url.searchParams.get("session"));
      const config = await getConfig(req, session);

      writeJson(res, 200, {
        ...config,
        addresses: isLocal ? config.addresses : [],
        canChooseDestination: isLocal,
        pinEnabled: session.pinEnabled
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

    if (url.pathname === "/api/note") {
      await handleNote(req, res, url);
      return;
    }

    if (url.pathname === "/api/pin/verify") {
      await handlePinVerify(req, res, url);
      return;
    }

    if (url.pathname === "/api/pin/status") {
      handlePinStatus(req, res, url);
      return;
    }

    if (url.pathname === "/api/pin/toggle") {
      await handlePinToggle(req, res, url);
      return;
    }

    if (url.pathname === "/api/session/renew") {
      await handleSessionRenew(req, res, url);
      return;
    }

    if (url.pathname === "/api/session/end") {
      await handleSessionEnd(req, res, url);
      return;
    }

    if (url.pathname === "/api/history/clear") {
      await handleHistoryClear(req, res, url);
      return;
    }

    if (url.pathname === "/api/session/disconnect-mobile") {
      await handleDisconnectMobile(req, res, url);
      return;
    }

    if (url.pathname === "/events") {
      const hasMobileKey = url.searchParams.has("key");
      const session = sessionFromKeyOrId(req, url, { requireMobileAuth: true });
      if (!session) {
        const expired = hasMobileKey && !sessionByKey(url);
        writeJson(res, 403, {
          ok: false,
          expired,
          pinRequired: !expired && hasMobileKey,
          error: expired ? EXPIRED_QR_MESSAGE : PIN_REQUIRED_MESSAGE
        });
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      const role = hasMobileKey ? "mobile" : "desktop";
      const mobileClientId = role === "mobile" ? crypto.randomUUID() : null;
      const authToken = role === "mobile" ? mobileAuthTokenFromRequest(req, url) : "";
      const client = { res, sessionId: session.id, role, mobileClientId, authToken };
      sseClients.add(client);
      if (role === "mobile") {
        session.mobileClients.set(mobileClientId, {
          label: deviceLabelFromUserAgent(req.headers["user-agent"]),
          connectedAt: Date.now(),
          lastSeen: Date.now(),
          authToken
        });
        broadcastState(session);
      }
      sendSseState(res, session);
      req.on("close", () => {
        sseClients.delete(client);
        if (role === "mobile") {
          session.mobileClients.delete(mobileClientId);
          broadcastState(session);
        }
      });
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

    if (url.pathname === "/download/bundle") {
      await handleDownloadBundle(req, res, url);
      return;
    }

    if (url.pathname === "/share/start") {
      await handleShareStart(req, res, url);
      return;
    }

    if (url.pathname === "/share/status") {
      await handleShareStatus(req, res, url);
      return;
    }

    if (url.pathname === "/share/chunk") {
      await handleShareChunk(req, res, url);
      return;
    }

    if (url.pathname === "/share/finish") {
      await handleShareFinish(req, res, url);
      return;
    }

    if (url.pathname === "/share/bundle") {
      await handleShareBundle(req, res, url);
      return;
    }

    if (url.pathname === "/share/cancel") {
      await handleShareCancel(req, res, url);
      return;
    }

    if (url.pathname === "/share/info") {
      await handleShareInfo(req, res, url);
      return;
    }

    if (url.pathname === "/share/download") {
      await handleShareDownload(req, res, url);
      return;
    }

    if (url.pathname === "/share/download-bundle") {
      await handleShareBundleDownload(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      const assetPath = path.join(PUBLIC_DIR, url.pathname.replace(/^\/assets\//, ""));
      await serveStatic(res, assetPath);
      return;
    }

    serveText(res, 404, "Nao encontrado");
  };
}

module.exports = {
  createRoute
};
