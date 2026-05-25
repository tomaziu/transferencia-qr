const qrImage = document.querySelector("#qrImage");
const qrLoader = document.querySelector("#qrLoader");
const sendLink = document.querySelector("#sendLink");
const copyButton = document.querySelector("#copyButton");
const qrNotice = document.querySelector("#qrNotice");
const addressList = document.querySelector("#addressList");
const connectionDot = document.querySelector("#connectionDot");
const connectionText = document.querySelector("#connectionText");
const currentTitle = document.querySelector("#currentTitle");
const percentLabel = document.querySelector("#percentLabel");
const progressFill = document.querySelector("#progressFill");
const receivedMetric = document.querySelector("#receivedMetric");
const speedMetric = document.querySelector("#speedMetric");
const etaMetric = document.querySelector("#etaMetric");
const emptyState = document.querySelector("#emptyState");
const historyList = document.querySelector("#historyList");
const historyCount = document.querySelector("#historyCount");
const destinationBox = document.querySelector("#destinationBox");
const currentDestination = document.querySelector("#currentDestination");
const openFolderButton = document.querySelector("#openFolderButton");
const folderModal = document.querySelector("#folderModal");
const closeFolderButton = document.querySelector("#closeFolderButton");
const folderUpButton = document.querySelector("#folderUpButton");
const folderPathInput = document.querySelector("#folderPathInput");
const rootList = document.querySelector("#rootList");
const folderList = document.querySelector("#folderList");
const folderError = document.querySelector("#folderError");
const saveFolderButton = document.querySelector("#saveFolderButton");

let currentFolder = null;
let parentFolder = null;
let currentSendUrl = "";
let destinationLoaded = false;

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

function setConnection(online) {
  connectionDot.classList.toggle("online", online);
  connectionDot.classList.toggle("offline", !online);
  connectionText.textContent = online ? "Pronto para receber" : "Reconectando...";
}

function renderAddresses(addresses) {
  addressList.innerHTML = "";
  for (const item of addresses) {
    const row = document.createElement("div");
    row.className = "address-item";
    row.innerHTML = `<span>${item.name}</span><strong>${item.address}</strong>`;
    addressList.append(row);
  }
}

function showQrNotice(message) {
  qrNotice.textContent = message;
  qrNotice.classList.remove("hidden");
}

function applyConfig(config, { notify = false } = {}) {
  const changed = currentSendUrl && currentSendUrl !== config.sendUrl;
  const shouldUpdateQr = !currentSendUrl || changed;
  currentSendUrl = config.sendUrl;

  if (shouldUpdateQr) {
    qrImage.addEventListener("load", () => qrLoader.classList.add("hidden"), { once: true });
    qrImage.src = config.qrCode;
    if (qrImage.complete) qrLoader.classList.add("hidden");
  }

  sendLink.value = config.sendUrl;
  renderAddresses(config.addresses || []);

  if (changed && notify) {
    showQrNotice("QR Code renovado. O codigo antigo expirou; escaneie este novo QR.");
  }

  if (config.canChooseDestination && !destinationLoaded) {
    destinationBox.hidden = false;
    destinationLoaded = true;
    loadDestination().catch(() => {
      destinationBox.hidden = true;
      destinationLoaded = false;
    });
  }
}

function renderProgress(transfer) {
  if (!transfer) {
    currentTitle.textContent = "Aguardando arquivo";
    percentLabel.textContent = "0%";
    progressFill.style.width = "0%";
    receivedMetric.textContent = "0 B";
    speedMetric.textContent = "0 B/s";
    etaMetric.textContent = "--";
    emptyState.classList.remove("hidden");
    return;
  }

  const percent = transfer.percent == null ? 100 : Math.max(0, Math.min(100, transfer.percent));
  currentTitle.textContent = transfer.status === "complete" ? `Recebido: ${transfer.savedName}` : transfer.fileName;
  percentLabel.textContent = `${Math.round(percent)}%`;
  progressFill.style.width = `${percent}%`;
  receivedMetric.textContent = `${formatBytes(transfer.received)} / ${formatBytes(transfer.size)}`;
  speedMetric.textContent = `${formatBytes(transfer.speed)}/s`;
  etaMetric.textContent = transfer.status === "paused" ? "pausado" : transfer.status === "complete" ? "concluido" : formatTime(transfer.eta);
  emptyState.classList.add("hidden");
}

function renderHistory(items) {
  historyCount.textContent = String(items.length);
  historyList.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-item";
    empty.innerHTML = "<strong>Nenhum arquivo recebido ainda</strong>";
    historyList.append(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "history-item";
    row.innerHTML = `
      <header>
        <strong>${escapeHtml(item.savedName)}</strong>
        <div class="history-actions">
          <span>${formatBytes(item.size)}</span>
          ${item.downloadUrl ? `
            <a class="download-button" href="${escapeHtml(item.downloadUrl)}" title="Baixar arquivo" aria-label="Baixar arquivo">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v12"></path>
                <path d="m7 10 5 5 5-5"></path>
                <path d="M5 21h14"></path>
              </svg>
            </a>
          ` : ""}
        </div>
      </header>
      <span class="history-meta">${escapeHtml(item.location || "Disponivel para download")} · ${formatTime(item.duration)}</span>
    `;
    historyList.append(row);
  }
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

function folderIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2"></path>
    </svg>
  `;
}

function applyState(state) {
  const active = state.active.find((item) => item.status === "receiving") || state.active[0];
  renderProgress(active);
  renderHistory(state.history || []);
}

function renderFolderRoots(roots) {
  rootList.innerHTML = "";

  for (const root of roots || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "root-button";
    button.textContent = root.name;
    button.addEventListener("click", () => loadFolders(root.path));
    rootList.append(button);
  }
}

function renderFolderList(folders) {
  folderList.innerHTML = "";

  if (!folders.length) {
    const empty = document.createElement("div");
    empty.className = "folder-row";
    empty.innerHTML = `${folderIcon()}<span>Nenhuma subpasta</span>`;
    folderList.append(empty);
    return;
  }

  for (const folder of folders) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-row";
    button.innerHTML = `${folderIcon()}<span>${escapeHtml(folder.name)}</span>`;
    button.addEventListener("click", () => loadFolders(folder.path));
    folderList.append(button);
  }
}

async function loadFolders(folderPath) {
  folderError.textContent = "";
  folderList.innerHTML = "";

  const query = folderPath ? `?path=${encodeURIComponent(folderPath)}` : "";
  const response = await fetch(`/api/folders${query}`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Nao foi possivel abrir esta pasta");
  }

  currentFolder = data.current;
  parentFolder = data.parent;
  folderPathInput.value = data.current || "";
  folderUpButton.disabled = !data.parent;
  renderFolderRoots(data.roots || []);
  renderFolderList(data.folders || []);
}

async function loadDestination() {
  const response = await fetch("/api/destination");
  const data = await response.json();

  if (!response.ok || !data.ok) {
    destinationBox.hidden = true;
    return;
  }

  currentDestination.textContent = data.destinationDir;
  folderPathInput.value = data.destinationDir;
}

function openFolderModal() {
  folderModal.classList.remove("hidden");
  const initialPath = currentDestination.textContent || folderPathInput.value;
  loadFolders(initialPath).catch((error) => {
    folderError.textContent = error.message;
    loadFolders("").catch(() => {});
  });
}

function closeFolderModal() {
  folderModal.classList.add("hidden");
  folderError.textContent = "";
}

async function saveDestination() {
  folderError.textContent = "";
  saveFolderButton.disabled = true;

  try {
    const response = await fetch("/api/destination", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationDir: folderPathInput.value })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Nao foi possivel salvar a pasta");
    }

    currentDestination.textContent = data.destinationDir;
    folderPathInput.value = data.destinationDir;
    closeFolderModal();
  } catch (error) {
    folderError.textContent = error.message;
  } finally {
    saveFolderButton.disabled = false;
  }
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  applyConfig(config);
}

async function checkQrCodeFreshness() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const config = await response.json();
    applyConfig(config, { notify: true });
  } catch {
    setConnection(false);
  }
}

function connectEvents() {
  const source = new EventSource("/events");

  source.addEventListener("open", () => setConnection(true));
  source.addEventListener("error", () => setConnection(false));
  source.addEventListener("state", (event) => {
    setConnection(true);
    applyState(JSON.parse(event.data));
  });
}

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(sendLink.value);
  } catch {
    sendLink.select();
    document.execCommand("copy");
  }

  copyButton.title = "Copiado";
  setTimeout(() => {
    copyButton.title = "Copiar link";
  }, 1200);
});

openFolderButton.addEventListener("click", openFolderModal);
closeFolderButton.addEventListener("click", closeFolderModal);
folderModal.addEventListener("click", (event) => {
  if (event.target === folderModal) closeFolderModal();
});
folderUpButton.addEventListener("click", () => {
  if (!parentFolder) return;
  loadFolders(parentFolder).catch((error) => {
    folderError.textContent = error.message;
  });
});
folderPathInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  loadFolders(folderPathInput.value).catch((error) => {
    folderError.textContent = error.message;
  });
});
saveFolderButton.addEventListener("click", saveDestination);

loadConfig().catch(() => {
  qrLoader.textContent = "Nao foi possivel gerar o QR Code";
});
connectEvents();
setInterval(checkQrCodeFreshness, 15000);
