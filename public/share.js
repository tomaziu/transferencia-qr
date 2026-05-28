const shareStatus = document.querySelector("#shareStatus");
const downloadFileName = document.querySelector("#downloadFileName");
const downloadFileSize = document.querySelector("#downloadFileSize");
const downloadFileButton = document.querySelector("#downloadFileButton");
const downloadList = document.querySelector("#downloadList");
const downloadMessage = document.querySelector("#downloadMessage");
const themeToggle = document.querySelector("#themeToggle");
function normalizeFiles(data) {
  if (Array.isArray(data.files) && data.files.length) return data.files;

  return [{
    fileName: data.fileName,
    size: data.size,
    downloadUrl: data.downloadUrl
  }];
}

function renderDownloadList(files) {
  downloadList.innerHTML = "";
  downloadList.classList.toggle("hidden", files.length <= 1);

  for (const file of files) {
    const row = document.createElement("article");
    row.className = "download-item";

    const info = document.createElement("div");
    const name = document.createElement("strong");
    const size = document.createElement("span");
    name.textContent = file.fileName || "Arquivo";
    size.textContent = formatBytes(file.size);
    info.append(name, size);

    const link = document.createElement("a");
    link.className = "download-small-button";
    link.href = file.downloadUrl;
    link.download = file.fileName || "";
    link.textContent = "Baixar";

    row.append(info, link);
    downloadList.append(row);
  }
}

async function loadSharedFile() {
  const params = new URLSearchParams(window.location.search);
  const response = await fetch(`/share/info?${params.toString()}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Arquivo indisponível ou link expirado");
  }

  const files = normalizeFiles(data);
  const totalSize = Number(data.totalSize ?? data.size ?? files.reduce((total, file) => total + Number(file.size || 0), 0));

  shareStatus.textContent = "Pronto";
  downloadFileName.textContent = files.length === 1 ? files[0].fileName : `${files.length} arquivos disponíveis`;
  downloadFileSize.textContent = files.length === 1 ? formatBytes(files[0].size) : `${formatBytes(totalSize)} no total`;

  if (data.zipDownloadUrl) {
    downloadFileButton.href = data.zipDownloadUrl;
    downloadFileButton.download = "";
    downloadFileButton.textContent = "Baixar tudo (.zip)";
    downloadFileButton.classList.remove("hidden");
  } else if (files.length === 1) {
    downloadFileButton.href = files[0].downloadUrl;
    downloadFileButton.download = files[0].fileName || "";
    downloadFileButton.textContent = "Baixar arquivo";
    downloadFileButton.classList.remove("hidden");
  } else {
    downloadFileButton.classList.add("hidden");
  }

  renderDownloadList(files);
  downloadMessage.textContent = data.zipDownloadUrl
    ? "Use o ZIP para manter pastas e subpastas. Downloads individuais salvam arquivos soltos."
    : "O navegador do celular decide a pasta de salvamento.";
}

themeToggle.addEventListener("click", () => {
  const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(currentTheme === "dark" ? "light" : "dark", themeToggle);
});

applyTheme(preferredTheme(), themeToggle);

loadSharedFile().catch((error) => {
  shareStatus.textContent = "Indisponível";
  downloadFileName.textContent = "Não foi possível abrir este arquivo";
  downloadFileSize.textContent = "--";
  downloadFileButton.classList.add("hidden");
  downloadList.classList.add("hidden");
  downloadList.innerHTML = "";
  downloadMessage.textContent = error.message;
});
