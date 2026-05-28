function isMobileUserAgent(req) {
  const ua = String(req.headers["user-agent"] || "");
  return /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

module.exports = { isMobileUserAgent };
