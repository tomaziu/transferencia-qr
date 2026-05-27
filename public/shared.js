const SHARED_THEME_KEY = "transferenciaQrTheme";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "--";
  if (seconds <= 1) return "menos de 1s";
  const total = Math.ceil(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes <= 0) return `${rest}s`;
  if (minutes < 60) return `${minutes}min ${rest.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}min`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function preferredTheme() {
  try {
    const saved = localStorage.getItem(SHARED_THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme, toggleButton) {
  const safeTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = safeTheme;
  toggleButton.textContent = safeTheme === "dark" ? "Tema claro" : "Tema escuro";
  toggleButton.setAttribute("aria-pressed", String(safeTheme === "dark"));
  try {
    localStorage.setItem(SHARED_THEME_KEY, safeTheme);
  } catch {
  }
}
