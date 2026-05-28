const qrImage = document.querySelector("#qrImage");
const qrLoader = document.querySelector("#qrLoader");
const sendLink = document.querySelector("#sendLink");
const copyButton = document.querySelector("#copyButton");
const qrNotice = document.querySelector("#qrNotice");
const qrNoticeText = document.querySelector("#qrNoticeText");
const qrNoticeClose = document.querySelector("#qrNoticeClose");
const addressList = document.querySelector("#addressList");
const connectionDot = document.querySelector("#connectionDot");
const connectionText = document.querySelector("#connectionText");

const themeToggle = document.querySelector("#themeToggle");
const sessionPin = document.querySelector("#sessionPin");
const pinVisibilityButton = document.querySelector("#pinVisibilityButton");
const pinToggleButton = document.querySelector("#pinToggleButton");
const pinBox = document.querySelector("#pinBox");
const qrStatusText = document.querySelector("#qrStatusText");
const pinStatusText = document.querySelector("#pinStatusText");
const sessionAgeText = document.querySelector("#sessionAgeText");
const deviceCount = document.querySelector("#deviceCount");
const deviceList = document.querySelector("#deviceList");
const renewQrButton = document.querySelector("#renewQrButton");
const endSessionButton = document.querySelector("#endSessionButton");
const currentTitle = document.querySelector("#currentTitle");
const percentLabel = document.querySelector("#percentLabel");
const progressFill = document.querySelector("#progressFill");
const receivedMetric = document.querySelector("#receivedMetric");
const speedMetric = document.querySelector("#speedMetric");
const etaMetric = document.querySelector("#etaMetric");
const notifyButton = document.querySelector("#notifyButton");
const emptyState = document.querySelector("#emptyState");
const historyList = document.querySelector("#historyList");
const historyCount = document.querySelector("#historyCount");
const clearHistoryButton = document.querySelector("#clearHistoryButton");
const downloadBundleButton = document.querySelector("#downloadBundleButton");
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
const shareFileInput = document.querySelector("#shareFileInput");
const shareFolderInput = document.querySelector("#shareFolderInput");
const shareFolderPicker = document.querySelector("#shareFolderPicker");
const shareDropZone = document.querySelector("#shareDropZone");
const shareFileName = document.querySelector("#shareFileName");
const shareFolderName = document.querySelector("#shareFolderName");
const sharePrepareButton = document.querySelector("#sharePrepareButton");
const shareCancelButton = document.querySelector("#shareCancelButton");
const shareProgress = document.querySelector("#shareProgress");
const shareProgressTitle = document.querySelector("#shareProgressTitle");
const sharePercentLabel = document.querySelector("#sharePercentLabel");
const shareProgressFill = document.querySelector("#shareProgressFill");
const shareReceivedLabel = document.querySelector("#shareReceivedLabel");
const shareEtaLabel = document.querySelector("#shareEtaLabel");
const shareResult = document.querySelector("#shareResult");
const shareQrImage = document.querySelector("#shareQrImage");
const shareReadyName = document.querySelector("#shareReadyName");
const shareReadySize = document.querySelector("#shareReadySize");

const shareReadyItems = document.querySelector("#shareReadyItems");
const shareLink = document.querySelector("#shareLink");
const shareCopyButton = document.querySelector("#shareCopyButton");
const sharedNote = document.querySelector("#sharedNote");
const noteStatus = document.querySelector("#noteStatus");
const noteCopyButton = document.querySelector("#noteCopyButton");

const RECEIVER_SESSION_KEY = "transferenciaQrReceiverSession";
const NOTIFY_KEY = "transferenciaQrNotifyEnabled";
const SHARE_CHUNK_SIZE = 1024 * 1024;
const SHARE_MAX_RETRIES = 3;

let currentFolder = null;
let parentFolder = null;
let currentSendUrl = "";
let destinationLoaded = false;
let selectedShareFiles = [];
let activeShareRequest = null;
let activeShareId = null;
let shareStopRequested = false;
let latestNoteUpdatedAt = 0;
let noteSaveTimer = null;
let currentSessionPin = "";
let pinVisible = false;
let pinEnabled = true;
let sessionCreatedAt = 0;
let shareReadyFiles = [];
let shareReadyTotalSize = 0;

let historyInitialized = false;
let knownHistoryIds = new Set();
let notifyEnabled = false;
let audioContext = null;
const receiverSessionId = getReceiverSessionId();

function createReceiverSessionId() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function getReceiverSessionId() {
  try {
    const existing = localStorage.getItem(RECEIVER_SESSION_KEY);
    if (/^[a-zA-Z0-9_-]{16,64}$/.test(existing || "")) return existing;

    const created = createReceiverSessionId();
    localStorage.setItem(RECEIVER_SESSION_KEY, created);
    return created;
  } catch {
    return createReceiverSessionId();
  }
}

function loadNotifyPreference() {
  try {
    return localStorage.getItem(NOTIFY_KEY) === "1";
  } catch {
    return false;
  }
}

function saveNotifyPreference(value) {
  try {
    localStorage.setItem(NOTIFY_KEY, value ? "1" : "0");
  } catch {
    // Ignore storage errors.
  }
}

function updateNotifyButton() {
  notifyButton.textContent = notifyEnabled ? "Avisos ligados" : "Ativar avisos";
  notifyButton.setAttribute("aria-pressed", String(notifyEnabled));
}

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function playDoneSound() {
  const context = ensureAudioContext();
  if (!context) return;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(660, now);
  oscillator.frequency.setValueAtTime(880, now + 0.08);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.3);
}

function browserNotify(title, body) {
  if (!notifyEnabled) return;

  playDoneSound();

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function notifyNewHistoryItems(items) {
  const ids = new Set(items.map((item) => item.id));

  if (!historyInitialized) {
    knownHistoryIds = ids;
    historyInitialized = true;
    return;
  }

  for (const item of items) {
    if (!knownHistoryIds.has(item.id)) {
      browserNotify("Arquivo recebido", item.savedName || item.fileName || "Transferencia concluida");
    }
  }

  knownHistoryIds = ids;
}

function sessionUrl(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}session=${encodeURIComponent(receiverSessionId)}`;
}

function createClientId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileDisplayName(file) {
  return file.relativePath || file.webkitRelativePath || file.name;
}

function formatSessionAge(timestamp) {
  const createdAt = Number(timestamp || 0);
  if (!createdAt) return "--";

  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return "agora";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `ha ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ha ${hours}h`;

  return `ha ${Math.floor(hours / 24)} dias`;
}

function updateSessionStatus() {
  qrStatusText.textContent = currentSendUrl ? "Ativo" : "Gerando";
  pinStatusText.textContent = pinEnabled ? "Ligado" : "Desligado";
  sessionAgeText.textContent = formatSessionAge(sessionCreatedAt);
}

function setConnection(online) {
  connectionDot.classList.toggle("online", online);
  connectionDot.classList.toggle("offline", !online);
  connectionText.textContent = online ? "Servidor online" : "Servidor reconectando...";
}

function renderMobilePresence(mobile) {
  const connected = Boolean(mobile?.connected);
  const count = Number(mobile?.count || 0);
  const clients = Array.isArray(mobile?.clients) ? mobile.clients : [];

  deviceCount.textContent = String(count);
  deviceList.innerHTML = "";

  if (!clients.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhum aparelho conectado.";
    deviceList.append(empty);
    return;
  }

  for (const client of clients) {
    const row = document.createElement("div");
    row.className = "device-item";

    const dot = document.createElement("span");
    dot.className = "device-dot";
    dot.setAttribute("aria-hidden", "true");

    const info = document.createElement("div");
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    const deviceName = client.label || "Aparelho";
    name.textContent = /conectado$/i.test(deviceName) ? deviceName : `${deviceName} conectado`;
    meta.textContent = `conectado ${formatSessionAge(client.connectedAt)}`;
    info.append(name, meta);

    const removeBtn = document.createElement("button");
    removeBtn.className = "icon-button";
    removeBtn.setAttribute("aria-label", "Remover aparelho");
    removeBtn.title = "Remover aparelho";
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    removeBtn.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/session/disconnect-mobile?session=" + encodeURIComponent(receiverSessionId), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientId: client.id })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error || "Nao foi possivel remover o aparelho");
        }
      } catch {
        alert("Erro ao remover aparelho");
      }
    });

    row.append(dot, info, removeBtn);
    deviceList.append(row);
  }
}

function renderAddresses(addresses) {
  addressList.innerHTML = "";
  addressList.hidden = !addresses.length;

  for (const item of addresses) {
    const row = document.createElement("div");
    row.className = "address-item";
    row.innerHTML = `<span>${item.name}</span><strong>${item.address}</strong>`;
    addressList.append(row);
  }
}

function showQrNotice(message) {
  qrNoticeText.textContent = message;
  qrNotice.classList.remove("hidden");
}

function hideQrNotice() {
  qrNotice.classList.add("hidden");
  qrNoticeText.textContent = "";
}

function renderSessionPin() {
  const pinLabel = pinBox.querySelector("span");
  const pinHidden = !pinEnabled || !currentSessionPin;
  sessionPin.textContent = pinHidden ? (pinEnabled ? "******" : "---") : (pinVisible ? currentSessionPin : "******");
  sessionPin.style.opacity = pinEnabled ? "1" : "0.4";
  pinVisibilityButton.hidden = !pinEnabled;
  pinToggleButton.textContent = pinEnabled ? "Desligar PIN" : "Ligar PIN";
  pinToggleButton.classList.toggle("danger-button", pinEnabled);
  if (pinLabel) pinLabel.textContent = pinEnabled ? "PIN de seguranca" : "PIN desligado";
  if (pinEnabled) {
    pinBox.style.borderColor = "";
    pinBox.style.background = "";
  } else {
    pinBox.style.borderColor = "rgba(15, 143, 134, 0.28)";
    pinBox.style.background = "rgba(15, 143, 134, 0.06)";
  }
  updateSessionStatus();
}

function setSessionPin(pin) {
  const nextPin = String(pin || "");
  if (nextPin !== currentSessionPin) pinVisible = false;
  currentSessionPin = nextPin;
  if (!currentSessionPin) pinVisible = false;
  renderSessionPin();
}

function applyConfig(config, { notify = false } = {}) {
  const changed = currentSendUrl && currentSendUrl !== config.sendUrl;
  const shouldUpdateQr = !currentSendUrl || changed;
  currentSendUrl = config.sendUrl;

  if (shouldUpdateQr) {
    qrLoader.classList.remove("hidden");
    qrImage.addEventListener("load", () => qrLoader.classList.add("hidden"), { once: true });
    qrImage.src = config.qrCode;
    if (qrImage.complete) qrLoader.classList.add("hidden");
  }

  sendLink.value = config.sendUrl;
  pinEnabled = config.pinEnabled !== false;
  sessionCreatedAt = Number(config.createdAt || sessionCreatedAt || 0);
  setSessionPin(config.pin);
  updateSessionStatus();
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
  } else if (!config.canChooseDestination) {
    destinationBox.hidden = true;
    destinationLoaded = false;
    closeFolderModal();
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

  const downloadable = items.filter((item) => item.downloadUrl);
  if (downloadable.length > 1) {
    const ids = downloadable.map((item) => item.id);
    const tokens = downloadable.map((item) => new URL(item.downloadUrl, window.location.origin).searchParams.get("token") || "");
    downloadBundleButton.hidden = false;
    downloadBundleButton.href = `/download/bundle?session=${encodeURIComponent(receiverSessionId)}&ids=${ids.map(encodeURIComponent).join(",")}&tokens=${tokens.map(encodeURIComponent).join(",")}`;
  } else {
    downloadBundleButton.hidden = true;
  }

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-item";
    empty.innerHTML = "<strong>Nenhum arquivo recebido ainda</strong>";
    historyList.append(empty);
    clearHistoryButton.hidden = true;
    return;
  }

  clearHistoryButton.hidden = false;

  for (const item of items) {
    const duration = Number(item.duration || 0);
    const averageSpeed = duration > 0 ? Number(item.size || 0) / duration : 0;
    const finishedMeta = duration > 0
      ? `terminou em ${formatTime(duration)} · media ${formatBytes(averageSpeed)}/s`
      : "concluido";
    const isImage = item.previewType && item.previewType.startsWith("image/");
    const isVideo = item.previewType && item.previewType.startsWith("video/");
    const isAudio = item.previewType && item.previewType.startsWith("audio/");
    const row = document.createElement("article");
    const previewHtml = item.previewUrl && isImage
      ? `<img class="history-preview" src="${escapeHtml(item.previewUrl)}" alt="Previa de ${escapeHtml(item.savedName)}" loading="lazy">`
      : isVideo
        ? `<video class="history-preview media-preview" src="${escapeHtml(item.previewUrl)}" controls preload="metadata"></video>`
        : "";
    const mediaHtml = isAudio && item.previewUrl
      ? `<audio class="audio-preview" src="${escapeHtml(item.previewUrl)}" controls preload="metadata"></audio>`
      : "";
    row.className = `history-item${item.previewUrl && isImage ? " with-preview" : ""}${isVideo ? " with-video-preview" : ""}`;
    row.innerHTML = `
      ${previewHtml}
      <div class="history-content">
        ${mediaHtml}
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
        <span class="history-meta">${escapeHtml(item.location || "Disponivel para download")} · ${escapeHtml(finishedMeta)}</span>
        </div>
    `;
    historyList.append(row);
  }
}

function folderIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2"></path>
    </svg>
  `;
}

function setNoteStatus(text) {
  noteStatus.textContent = text;
}

function applySharedNoteText(text) {
  const wasFocused = document.activeElement === sharedNote;
  const oldLength = sharedNote.value.length;
  const selectionStart = sharedNote.selectionStart;
  const selectionEnd = sharedNote.selectionEnd;

  if (sharedNote.value !== text) {
    sharedNote.value = text;

    if (wasFocused && typeof sharedNote.setSelectionRange === "function") {
      const delta = text.length - oldLength;
      const nextStart = Math.max(0, Math.min(text.length, selectionStart + delta));
      const nextEnd = Math.max(0, Math.min(text.length, selectionEnd + delta));
      sharedNote.setSelectionRange(nextStart, nextEnd);
    }
  }
}

function renderSharedNote(note) {
  if (!note) return;

  const updatedAt = Number(note.updatedAt || 0);
  const text = String(note.text || "");
  if (updatedAt < latestNoteUpdatedAt) return;

  applySharedNoteText(text);
  latestNoteUpdatedAt = updatedAt;
  setNoteStatus("Sincronizado");
}

async function saveSharedNote() {
  const text = sharedNote.value;
  setNoteStatus("Salvando...");

  try {
    const response = await fetch(sessionUrl("/api/note"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await readJsonResponse(response);
    renderSharedNote(data.note);
  } catch {
    setNoteStatus("Falha ao salvar");
  }
}

function scheduleNoteSave() {
  clearTimeout(noteSaveTimer);
  setNoteStatus("Digitando...");
  noteSaveTimer = setTimeout(saveSharedNote, 450);
}

function applyState(state) {
  const active = state.active.find((item) => item.status === "receiving") || state.active[0];
  if (state.session) {
    sessionCreatedAt = Number(state.session.createdAt || sessionCreatedAt || 0);
    pinEnabled = state.session.pinEnabled !== false;
    renderSessionPin();
  }
  notifyNewHistoryItems(state.history || []);
  renderProgress(active);
  renderHistory(state.history || []);
  renderMobilePresence(state.mobile);
  renderSharedNote(state.note);
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

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "Falha na operacao");
    error.received = data.received;
    throw error;
  }

  return data;
}

function setShareControls(uploading) {
  sharePrepareButton.disabled = uploading || selectedShareFiles.length === 0;
  sharePrepareButton.textContent = uploading ? "Preparando..." : "Gerar QR";
  shareCancelButton.hidden = !uploading;
  shareCancelButton.disabled = shareStopRequested;
  shareFileInput.disabled = uploading;
  shareFolderInput.disabled = uploading;
}

function resetShareProgress() {
  shareProgress.classList.add("hidden");
  shareProgressTitle.textContent = "Preparando arquivo";
  sharePercentLabel.textContent = "0%";
  shareProgressFill.style.width = "0%";
  shareReceivedLabel.textContent = "0 B";
  shareEtaLabel.textContent = "--";
}

function updateShareProgress(file, received, startedAt, baseOffset, queue = null) {
  const totalSize = queue?.totalSize || file.size;
  const totalReceived = queue ? Math.min(totalSize, queue.completedBytes + received) : received;
  const measuredReceived = queue ? totalReceived : Math.max(0, received - baseOffset);
  const percent = totalSize > 0 ? Math.min(100, (totalReceived / totalSize) * 100) : 100;
  const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
  const speed = measuredReceived / elapsed;
  const remaining = Math.max(0, totalSize - totalReceived);
  const eta = remaining > 0 && speed > 0 ? remaining / speed : 0;
  const titlePrefix = queue && queue.total > 1 ? `Arquivo ${queue.index}/${queue.total}: ` : "";

  shareProgress.classList.remove("hidden");
  shareProgressTitle.textContent = `${titlePrefix}${fileDisplayName(file)}`;
  sharePercentLabel.textContent = `${Math.round(percent)}%`;
  shareProgressFill.style.width = `${percent}%`;
  shareReceivedLabel.textContent = `${formatBytes(totalReceived)} / ${formatBytes(totalSize)} · ${formatBytes(speed)}/s`;
  shareEtaLabel.textContent = formatTime(eta);
}

async function startShareUpload(id, file) {
  const response = await fetch(sessionUrl("/share/start"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      fileName: fileDisplayName(file),
      size: file.size
    })
  });

  return readJsonResponse(response);
}

async function requestShareStatus(id) {
  const response = await fetch(sessionUrl(`/share/status?id=${encodeURIComponent(id)}`));
  return readJsonResponse(response);
}

async function finishShareUpload(id) {
  const response = await fetch(sessionUrl("/share/finish"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });

  return readJsonResponse(response);
}

async function createShareBundle(ids) {
  const response = await fetch(sessionUrl("/share/bundle"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids })
  });

  return readJsonResponse(response);
}

async function cancelShareUpload(id) {
  if (!id) return;

  await fetch(sessionUrl("/share/cancel"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
}

function uploadShareChunk(id, file, offset, chunk, startedAt, baseOffset, queue = null) {
  return new Promise((resolve, reject) => {
    if (shareStopRequested) {
      reject(new Error("Envio cancelado"));
      return;
    }

    const xhr = new XMLHttpRequest();
    activeShareRequest = xhr;

    const clearActiveRequest = () => {
      if (activeShareRequest === xhr) {
        activeShareRequest = null;
      }
    };

    xhr.open("POST", sessionUrl(`/share/chunk?id=${encodeURIComponent(id)}&offset=${encodeURIComponent(offset)}`));
    xhr.setRequestHeader("content-type", "application/octet-stream");

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      updateShareProgress(file, offset + event.loaded, startedAt, baseOffset, queue);
    });

    xhr.addEventListener("load", () => {
      clearActiveRequest();
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = { error: xhr.responseText || "Falha ao preparar arquivo" };
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }

      if (xhr.status === 409 && typeof data.received === "number") {
        resolve(data);
        return;
      }

      const error = new Error(data.error || "Falha ao preparar arquivo");
      error.received = data.received;
      reject(error);
    });

    xhr.addEventListener("error", () => {
      clearActiveRequest();
      reject(new Error("Erro de rede"));
    });
    xhr.addEventListener("abort", () => {
      clearActiveRequest();
      reject(new Error("Envio cancelado"));
    });
    xhr.send(chunk);
  });
}

function renderShareReadyFiles() {
  shareReadyItems.innerHTML = "";

  for (const file of shareReadyFiles) {
    const row = document.createElement("div");
    row.className = "share-ready-item";

    const name = document.createElement("strong");
    name.textContent = file.fileName || "Arquivo";

    const size = document.createElement("span");
    size.textContent = formatBytes(file.size);

    row.append(name, size);
    shareReadyItems.append(row);
  }
}

function renderShareResult(data) {
  const files = Array.isArray(data.files) && data.files.length
    ? data.files
    : [{ fileName: data.fileName, size: data.size }];
  const totalSize = Number(data.totalSize ?? data.size ?? files.reduce((total, file) => total + Number(file.size || 0), 0));

  shareReadyFiles = files;
  shareReadyTotalSize = totalSize;

  shareResult.classList.remove("hidden");
  shareQrImage.src = data.qrCode;
  shareReadyName.textContent = files.length === 1 ? files[0].fileName : `${files.length} arquivos prontos`;
  shareReadySize.textContent = files.length === 1 ? formatBytes(files[0].size) : `${formatBytes(totalSize)} no total`;
  shareLink.value = data.shareUrl;
  renderShareReadyFiles();
}

async function prepareOneShareFile(file, id, queue) {
  activeShareId = id;

  const start = await startShareUpload(id, file);
  let offset = Math.min(Number(start.received || 0), file.size);
  const chunkSize = Math.max(256 * 1024, Number(start.chunkSize || SHARE_CHUNK_SIZE));
  const startedAt = queue?.startedAt || Date.now();
  const baseOffset = offset;

  updateShareProgress(file, offset, startedAt, baseOffset, queue);

  while (offset < file.size) {
    if (shareStopRequested) throw new Error("Envio cancelado");

    const end = Math.min(offset + chunkSize, file.size);
    const chunk = file.slice(offset, end);
    let attempts = 0;

    while (true) {
      try {
        const result = await uploadShareChunk(id, file, offset, chunk, startedAt, baseOffset, queue);
        offset = Math.min(Number(result.received || end), file.size);
        updateShareProgress(file, offset, startedAt, baseOffset, queue);
        break;
      } catch (error) {
        if (shareStopRequested) throw error;

        attempts += 1;
        try {
          const status = await requestShareStatus(id);
          if (typeof status.received === "number" && status.received > offset) {
            offset = Math.min(status.received, file.size);
            updateShareProgress(file, offset, startedAt, baseOffset, queue);
            break;
          }
        } catch {
          // The next retry decides whether the connection recovered.
        }

        if (attempts >= SHARE_MAX_RETRIES) throw error;

        shareEtaLabel.textContent = `reconectando ${attempts}/${SHARE_MAX_RETRIES}`;
        await new Promise((resolve) => setTimeout(resolve, 800 * attempts));
      }
    }
  }

  const result = await finishShareUpload(id);
  updateShareProgress(file, file.size, startedAt, baseOffset, queue);
  activeShareId = null;
  return result;
}

async function prepareShareFiles() {
  if (!selectedShareFiles.length) return;

  const files = [...selectedShareFiles];
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  const prepared = [];
  let completedBytes = 0;

  shareStopRequested = false;
  shareResult.classList.add("hidden");
  resetShareProgress();
  setShareControls(true);

  try {
    const startedAt = Date.now();

    for (const [index, file] of files.entries()) {
      const id = createClientId();
      const queue = {
        index: index + 1,
        total: files.length,
        completedBytes,
        totalSize,
        startedAt
      };
      const result = await prepareOneShareFile(file, id, queue);
      prepared.push(result);
      completedBytes += file.size;
    }

    shareEtaLabel.textContent = "pronto";

    if (prepared.length === 1) {
      renderShareResult(prepared[0]);
    } else {
      shareProgressTitle.textContent = "Gerando QR dos arquivos";
      const bundle = await createShareBundle(prepared.map((file) => file.id));
      renderShareResult(bundle);
    }

    const duration = Math.max(0.001, (Date.now() - startedAt) / 1000);
    const averageSpeed = totalSize / duration;
    shareReceivedLabel.textContent = `${formatBytes(totalSize)} enviados`;
    shareEtaLabel.textContent = `terminou em ${formatTime(duration)} · media ${formatBytes(averageSpeed)}/s`;
    browserNotify("Arquivos prontos", files.length === 1 ? fileDisplayName(files[0]) : `${files.length} arquivos preparados para o celular`);
  } catch (error) {
    shareProgress.classList.remove("hidden");
    shareProgressTitle.textContent = shareStopRequested ? "Envio cancelado" : "Falha ao preparar arquivos";
    shareEtaLabel.textContent = error.message || "erro";
    const idsToCancel = new Set(prepared.map((file) => file.id));
    if (activeShareId) idsToCancel.add(activeShareId);
    await Promise.allSettled([...idsToCancel].map((id) => cancelShareUpload(id)));
  } finally {
    activeShareRequest = null;
    activeShareId = null;
    shareStopRequested = false;
    setShareControls(false);
  }
}

async function loadConfig() {
  const response = await fetch(sessionUrl("/api/config"));
  const config = await response.json();
  applyConfig(config);
}

async function checkQrCodeFreshness() {
  try {
    const response = await fetch(sessionUrl("/api/config"), { cache: "no-store" });
    const config = await response.json();
    applyConfig(config, { notify: true });
  } catch {
    setConnection(false);
  }
}

async function postSessionAction(path, button, successMessage) {
  button.disabled = true;

  try {
    const response = await fetch(sessionUrl(path), { method: "POST" });
    const data = await readJsonResponse(response);
    applyConfig(data, { notify: true });
    if (data.state) applyState(data.state);
    if (successMessage) showQrNotice(successMessage);
    return data;
  } finally {
    button.disabled = false;
  }
}

async function renewQrCode() {
  await postSessionAction(
    "/api/session/renew",
    renewQrButton,
    "QR Code renovado. O codigo antigo e o PIN antigo nao funcionam mais."
  );
}

async function endSession() {
  const confirmed = window.confirm("Encerrar esta sessao? O QR atual, PIN, links e lista de recebidos serao limpos.");
  if (!confirmed) return;

  shareResult.classList.add("hidden");
  resetShareProgress();
  await postSessionAction(
    "/api/session/end",
    endSessionButton,
    "Sessao encerrada. Um novo QR Code e um novo PIN foram gerados."
  );
}

function connectEvents() {
  const source = new EventSource(sessionUrl("/events"));

  source.addEventListener("open", () => setConnection(true));
  source.addEventListener("error", () => setConnection(false));
  source.addEventListener("state", (event) => {
    setConnection(true);
    applyState(JSON.parse(event.data));
  });
}

async function copyTextToClipboard(text, fallbackInput = null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    if (fallbackInput) {
      fallbackInput.select();
      document.execCommand("copy");
    }
  }
}

copyButton.addEventListener("click", async () => {
  await copyTextToClipboard(sendLink.value, sendLink);

  copyButton.title = "Copiado";
  setTimeout(() => {
    copyButton.title = "Copiar link";
  }, 1200);
});

qrNoticeClose.addEventListener("click", hideQrNotice);

function folderNameFromFiles(files) {
  const firstPath = files.find((file) => file.relativePath || file.webkitRelativePath);
  const pathName = firstPath ? fileDisplayName(firstPath) : "";
  return pathName.split("/")[0] || "";
}

function updateShareSelection(fileList, source, otherInput) {
  selectedShareFiles = Array.from(fileList || []);
  const totalSize = selectedShareFiles.reduce((total, file) => total + file.size, 0);
  const folderName = folderNameFromFiles(selectedShareFiles);
  const summary = selectedShareFiles.length === 0
    ? source === "folder" ? "Nenhuma pasta escolhida" : "Nenhum arquivo escolhido"
    : selectedShareFiles.length === 1
      ? fileDisplayName(selectedShareFiles[0])
      : source === "folder" && folderName
        ? `${selectedShareFiles.length} arquivos de ${folderName} · ${formatBytes(totalSize)}`
        : `${selectedShareFiles.length} arquivos escolhidos · ${formatBytes(totalSize)}`;

  if (source === "folder") {
    shareFolderName.textContent = summary;
    shareFileName.textContent = "Nenhum arquivo escolhido";
  } else {
    shareFileName.textContent = summary;
    shareFolderName.textContent = "Nenhuma pasta escolhida";
  }

  if (otherInput) otherInput.value = "";
  resetShareProgress();
  shareResult.classList.add("hidden");
  shareReadyFiles = [];
  shareReadyTotalSize = 0;
  shareReadyItems.innerHTML = "";
  setShareControls(false);
}

function withRelativePath(file, relativePath) {
  const cleanPath = String(relativePath || file.name).replace(/\\/g, "/").replace(/^\/+/, "");

  try {
    Object.defineProperty(file, "relativePath", {
      value: cleanPath,
      configurable: true
    });
  } catch {
    file.relativePath = cleanPath;
  }

  return file;
}

function readEntryFile(entry, relativePath) {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve(withRelativePath(file, relativePath || entry.name)),
      reject
    );
  });
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function collectEntryFiles(entry, basePath = "") {
  const nextPath = basePath ? `${basePath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    return [await readEntryFile(entry, nextPath)];
  }

  if (!entry.isDirectory) return [];

  const reader = entry.createReader();
  const files = [];

  while (true) {
    const entries = await readDirectoryEntries(reader);
    if (!entries.length) break;

    for (const child of entries) {
      files.push(...(await collectEntryFiles(child, nextPath)));
    }
  }

  return files;
}

async function collectDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  const entryItems = items
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (!entryItems.length) {
    return Array.from(dataTransfer.files || []);
  }

  const groups = await Promise.all(entryItems.map((entry) => collectEntryFiles(entry)));
  return groups.flat();
}

async function handleShareDrop(event) {
  event.preventDefault();
  shareDropZone.classList.remove("drag-over");

  if (sharePrepareButton.disabled && selectedShareFiles.length > 0) return;

  const files = await collectDroppedFiles(event.dataTransfer);
  updateShareSelection(files, "drop");
  shareFileInput.value = "";
  shareFolderInput.value = "";
}

shareFileInput.addEventListener("change", () => {
  updateShareSelection(shareFileInput.files, "files", shareFolderInput);
});

shareFolderInput.addEventListener("change", () => {
  updateShareSelection(shareFolderInput.files, "folder", shareFileInput);
});

shareDropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  shareDropZone.classList.add("drag-over");
});

shareDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  shareDropZone.classList.add("drag-over");
});

shareDropZone.addEventListener("dragleave", (event) => {
  if (!shareDropZone.contains(event.relatedTarget)) {
    shareDropZone.classList.remove("drag-over");
  }
});

shareDropZone.addEventListener("drop", (event) => {
  handleShareDrop(event).catch((error) => {
    shareDropZone.classList.remove("drag-over");
    shareEtaLabel.textContent = error.message || "nao foi possivel ler os arquivos";
  });
});

sharePrepareButton.addEventListener("click", () => {
  prepareShareFiles();
});

shareCancelButton.addEventListener("click", () => {
  shareStopRequested = true;
  shareCancelButton.disabled = true;
  if (activeShareRequest) {
    activeShareRequest.abort();
  }
});

shareCopyButton.addEventListener("click", async () => {
  await copyTextToClipboard(shareLink.value, shareLink);

  shareCopyButton.title = "Copiado";
  setTimeout(() => {
    shareCopyButton.title = "Copiar link";
  }, 1200);
});

noteCopyButton.addEventListener("click", async () => {
  await copyTextToClipboard(sharedNote.value, sharedNote);
  setNoteStatus("Texto copiado");
  setTimeout(() => setNoteStatus("Sincronizado"), 1200);
});

const notePasteButton = document.getElementById("notePasteButton");
if (notePasteButton) {
  notePasteButton.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      const start = sharedNote.selectionStart;
      const end = sharedNote.selectionEnd;
      const before = sharedNote.value.slice(0, start);
      const after = sharedNote.value.slice(end);
      sharedNote.value = before + text + after;
      sharedNote.selectionStart = sharedNote.selectionEnd = start + text.length;
      sharedNote.dispatchEvent(new Event("input", { bubbles: true }));
      sharedNote.focus();
      setNoteStatus("Texto colado");
      setTimeout(() => setNoteStatus("Sincronizado"), 1200);
    } catch {
      setNoteStatus("Nao foi possivel colar");
      setTimeout(() => setNoteStatus("Sincronizado"), 1200);
    }
  });
}

themeToggle.addEventListener("click", () => {
  const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(currentTheme === "dark" ? "light" : "dark", themeToggle);
});

notifyButton.addEventListener("click", async () => {
  notifyEnabled = !notifyEnabled;

  if (notifyEnabled && "Notification" in window && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      // The sound alert still works if notification permission is unavailable.
    }
  }

  if (notifyEnabled) ensureAudioContext();
  saveNotifyPreference(notifyEnabled);
  updateNotifyButton();
});

pinVisibilityButton.addEventListener("click", () => {
  pinVisible = !pinVisible;
  renderSessionPin();
});

pinToggleButton.addEventListener("click", async () => {
  pinToggleButton.disabled = true;
  try {
    const response = await fetch(sessionUrl("/api/pin/toggle"), { method: "POST" });
    const data = await readJsonResponse(response);
    pinEnabled = data.pinEnabled !== false;
    currentSendUrl = data.sendUrl || currentSendUrl;
    sessionCreatedAt = Number(data.createdAt || sessionCreatedAt || 0);
    sendLink.value = data.sendUrl;
    setSessionPin(data.pin);
    renderAddresses(data.addresses || []);
    if (data.qrCode) {
      qrLoader.classList.remove("hidden");
      qrImage.addEventListener("load", () => qrLoader.classList.add("hidden"), { once: true });
      qrImage.src = data.qrCode;
      if (qrImage.complete) qrLoader.classList.add("hidden");
    }
    if (data.state) applyState(data.state);
  } catch (error) {
    showQrNotice(error.message || "Nao foi possivel alterar o PIN");
  } finally {
    pinToggleButton.disabled = false;
  }
});

clearHistoryButton.addEventListener("click", () => {
  if (!window.confirm("Limpar historico de recebidos? Os links de download serao perdidos.")) return;
  fetch(sessionUrl("/api/history/clear"), { method: "POST" }).catch(() => {});
});

renewQrButton.addEventListener("click", () => {
  renewQrCode().catch((error) => showQrNotice(error.message || "Nao foi possivel renovar o QR Code"));
});

endSessionButton.addEventListener("click", () => {
  endSession().catch((error) => showQrNotice(error.message || "Nao foi possivel encerrar a sessao"));
});

sharedNote.addEventListener("input", scheduleNoteSave);
sharedNote.addEventListener("blur", () => {
  clearTimeout(noteSaveTimer);
  saveSharedNote();
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

applyTheme(preferredTheme(), themeToggle);
notifyEnabled = loadNotifyPreference();
updateNotifyButton();
updateSessionStatus();
loadConfig().catch(() => {
  qrLoader.textContent = "Nao foi possivel gerar o QR Code";
});
setShareControls(false);
resetShareProgress();
if (!("webkitdirectory" in shareFolderInput)) {
  shareFolderPicker.classList.add("hidden");
}
connectEvents();
setInterval(checkQrCodeFreshness, 15000);
setInterval(updateSessionStatus, 30000);
