function deviceLabelFromUserAgent(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return "Aparelho conectado";

  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";

  const androidMatch = ua.match(/Android [^;)]*;\s*([^;)]+?)(?:\s+Build|\)|;)/i);
  if (androidMatch) {
    const rawModel = androidMatch[1]
      .replace(/\bwv\b/gi, "")
      .replace(/\bMobile\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (rawModel && !/Chrome|Safari|Version|Linux/i.test(rawModel)) {
      return rawModel.slice(0, 48);
    }

    return "Celular Android";
  }

  if (/Android/i.test(ua)) return "Celular Android";
  if (/Mobile|Phone/i.test(ua)) return "Celular";
  return "Aparelho conectado";
}

function publicMobilePresence(session) {
  const clients = Array.from(session.mobileClients.entries()).map(([id, client]) => ({
    id,
    label: client.label || "Aparelho conectado",
    connectedAt: client.connectedAt,
    lastSeen: client.lastSeen || client.connectedAt
  }));
  const firstClient = clients[0] || null;

  return {
    connected: clients.length > 0,
    count: clients.length,
    label: firstClient?.label || null,
    clients
  };
}

module.exports = {
  deviceLabelFromUserAgent,
  publicMobilePresence
};
