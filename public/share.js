const shareStatus = document.querySelector("#shareStatus");
const downloadFileName = document.querySelector("#downloadFileName");
const downloadFileSize = document.querySelector("#downloadFileSize");
const downloadFileButton = document.querySelector("#downloadFileButton");
const downloadMessage = document.querySelector("#downloadMessage");

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

async function loadSharedFile() {
  const params = new URLSearchParams(window.location.search);
  const response = await fetch(`/share/info?${params.toString()}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Arquivo indisponivel ou link expirado");
  }

  shareStatus.textContent = "Pronto";
  downloadFileName.textContent = data.fileName;
  downloadFileSize.textContent = formatBytes(data.size);
  downloadFileButton.href = data.downloadUrl;
  downloadFileButton.classList.remove("hidden");
  downloadMessage.textContent = "O navegador do celular decide a pasta de salvamento.";
}

loadSharedFile().catch((error) => {
  shareStatus.textContent = "Indisponivel";
  downloadFileName.textContent = "Nao foi possivel abrir este arquivo";
  downloadFileSize.textContent = "--";
  downloadFileButton.classList.add("hidden");
  downloadMessage.textContent = error.message;
});
