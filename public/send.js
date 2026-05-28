const phoneConnectionLabel = document.querySelector("#phoneConnectionLabel");
const themeToggle = document.querySelector("#themeToggle");
const pinPanel = document.querySelector("#pinPanel");
const pinInput = document.querySelector("#pinInput");
const pinButton = document.querySelector("#pinButton");
const pinMessage = document.querySelector("#pinMessage");
const transferPanel = document.querySelector("#transferPanel");
const fileInput = document.querySelector("#fileInput");
const folderInput = document.querySelector("#folderInput");
const folderPicker = document.querySelector("#folderPicker");
const sendButton = document.querySelector("#sendButton");
const stopButton = document.querySelector("#stopButton");
const queue = document.querySelector("#queue");
const queueSummary = document.querySelector("#queueSummary");
const queueStep = document.querySelector("#queueStep");
const queueCurrent = document.querySelector("#queueCurrent");
const queueNext = document.querySelector("#queueNext");
const sizeAdvice = document.querySelector("#sizeAdvice");
const sizeAdviceTitle = document.querySelector("#sizeAdviceTitle");
const sizeAdviceText = document.querySelector("#sizeAdviceText");
const resumeAdvice = document.querySelector("#resumeAdvice");
const resumeAdviceTitle = document.querySelector("#resumeAdviceTitle");
const resumeAdviceText = document.querySelector("#resumeAdviceText");
const discardResumeButton = document.querySelector("#discardResumeButton");
const mobileNotePanel = document.querySelector("#mobileNotePanel");
const sharedNote = document.querySelector("#sharedNote");
const noteStatus = document.querySelector("#noteStatus");
const noteCopyButton = document.querySelector("#noteCopyButton");
const key = new URLSearchParams(window.location.search).get("key") || "";

const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const MAX_CHUNK_RETRIES = 3;
const ONE_GB = 1024 * 1024 * 1024;
const PENDING_UPLOADS_KEY = `transferenciaQrPendingUploads:${key.slice(0, 16) || "default"}`;
const AUTH_STORAGE_KEY = `transferenciaQrMobileAuth:${key.slice(0, 16) || "default"}`;
let selectedFiles = [];
let sending = false;
let activeFileId = null;
let activeFileIndex = -1;
let activeChunkRequest = null;
let stopRequested = false;
let latestNoteUpdatedAt = 0;
let noteSaveTimer = null;
let mobileAuthToken = "";
let noteEventSource = null;

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadMobileAuthToken() {
  try {
    return sessionStorage.getItem(AUTH_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveMobileAuthToken(token) {
  mobileAuthToken = token || "";

  try {
    if (mobileAuthToken) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, mobileAuthToken);
    } else {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // The token still works in memory for this tab.
  }
}

function authenticatedUrl(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("key", key);
  if (mobileAuthToken) url.searchParams.set("auth", mobileAuthToken);
  return `${url.pathname}${url.search}`;
}

async function createFileId(file) {
  const source = `${fileDisplayName(file)}|${file.size}|${file.lastModified}`;

  if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
    const bytes = new TextEncoder().encode(source);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return createId();
}

function fileDisplayName(file) {
  return file.webkitRelativePath || file.name;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStoppedError() {
  const error = new Error("Envio parado");
  error.stopped = true;
  return error;
}

function renderUploadControls() {
  if (sending) {
    sendButton.disabled = true;
    sendButton.textContent = stopRequested ? "Parando..." : "Enviando...";
    stopButton.hidden = false;
    stopButton.disabled = stopRequested;
    stopButton.textContent = stopRequested ? "Parando..." : "Parar";
    fileInput.disabled = true;
    folderInput.disabled = true;
    return;
  }

  sendButton.textContent = "Enviar";
  sendButton.disabled = !selectedFiles.length;
  stopButton.hidden = true;
  stopButton.disabled = true;
  stopButton.textContent = "Parar";
  fileInput.disabled = false;
  folderInput.disabled = false;
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
    const response = await fetch(authenticatedUrl("/api/note"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await readJsonResponse(response);
    renderSharedNote(data.note);
  } catch (error) {
    if (error.expired) {
      showExpiredSession(error.message);
      return;
    }
    if (error.pinRequired) {
      saveMobileAuthToken("");
      showPinPanel(error.message);
      return;
    }
    setNoteStatus("Falha ao salvar");
  }
}

function scheduleNoteSave() {
  clearTimeout(noteSaveTimer);
  setNoteStatus("Digitando...");
  noteSaveTimer = setTimeout(saveSharedNote, 450);
}

function showPinPanel(message = "") {
  phoneConnectionLabel.textContent = "Aguardando PIN";
  pinPanel.hidden = false;
  transferPanel.hidden = true;
  mobileNotePanel.hidden = true;
  pinInput.disabled = false;
  pinButton.disabled = false;
  pinMessage.textContent = message;
  pinInput.focus();
}

function showExpiredSession(message) {
  saveMobileAuthToken("");
  phoneConnectionLabel.textContent = "Sessao expirada";
  pinPanel.hidden = false;
  transferPanel.hidden = true;
  mobileNotePanel.hidden = true;
  pinInput.disabled = true;
  pinButton.disabled = true;
  pinMessage.textContent = message || "Sessao expirada. Escaneie o novo QR Code no computador.";

  if (noteEventSource) {
    noteEventSource.close();
    noteEventSource = null;
  }
}

function showTransferUi(note = null) {
  phoneConnectionLabel.textContent = "Conectado";
  pinPanel.hidden = true;
  transferPanel.hidden = false;
  mobileNotePanel.hidden = false;
  if (note) renderSharedNote(note);
  renderPendingNotice();
  renderUploadControls();
  updateQueueSummary();
  connectNoteEvents();
}

async function verifyPin() {
  const pin = pinInput.value.replace(/\D/g, "");
  if (pin.length !== 6) {
    pinMessage.textContent = "Digite os 6 numeros do PIN.";
    return;
  }

  pinButton.disabled = true;
  pinMessage.textContent = "Validando...";

  try {
    const response = await fetch(`/api/pin/verify?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin })
    });
    const data = await readJsonResponse(response);
    saveMobileAuthToken(data.auth);
    showTransferUi(data.note);
  } catch (error) {
    if (error.expired) {
      showExpiredSession(error.message);
      return;
    }

    pinMessage.textContent = error.message || "PIN incorreto.";
    pinButton.disabled = false;
  }
}

async function tryAutoAuth() {
  try {
    const response = await fetch(`/api/pin/verify?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const data = await readJsonResponse(response);
    saveMobileAuthToken(data.auth);
    showTransferUi(data.note);
    return true;
  } catch (error) {
    if (error.expired) {
      showExpiredSession(error.message);
      return true;
    }
    return false;
  }
}

async function verifyStoredAuth() {
  mobileAuthToken = loadMobileAuthToken();
  if (!mobileAuthToken) return false;

  try {
    const response = await fetch(authenticatedUrl("/api/pin/status"), { cache: "no-store" });
    const data = await readJsonResponse(response);
    if (!data.verified) {
      saveMobileAuthToken("");
      return false;
    }

    showTransferUi(data.note);
    return true;
  } catch (error) {
    if (error.expired) {
      showExpiredSession(error.message);
      return true;
    }
    saveMobileAuthToken("");
    return false;
  }
}

function connectNoteEvents() {
  if (noteEventSource) noteEventSource.close();

  const source = new EventSource(authenticatedUrl("/events"));
  noteEventSource = source;

  source.addEventListener("open", () => setNoteStatus("Sincronizado"));
  source.addEventListener("error", () => setNoteStatus("Reconectando..."));
  source.addEventListener("state", (event) => {
    renderSharedNote(JSON.parse(event.data).note);
  });
  source.addEventListener("expired", (event) => {
    const data = JSON.parse(event.data || "{}");
    showExpiredSession(data.error);
  });
}

function getPendingUploads() {
  try {
    const items = JSON.parse(localStorage.getItem(PENDING_UPLOADS_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function savePendingUploads(items) {
  try {
    localStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify(items.slice(0, 12)));
  } catch {
    // Some browsers may block localStorage; resume hints are optional.
  }
}

function rememberPendingUpload(fileInfo, received = 0) {
  const pending = getPendingUploads().filter((item) => item.id !== fileInfo.id);
  pending.unshift({
    id: fileInfo.id,
    name: fileInfo.name,
    size: fileInfo.size,
    lastModified: fileInfo.file?.lastModified || fileInfo.lastModified || 0,
    received,
    updatedAt: Date.now()
  });
  savePendingUploads(pending);
}

function forgetPendingUpload(id) {
  savePendingUploads(getPendingUploads().filter((item) => item.id !== id));
  renderPendingNotice();
}

function matchingPendingUpload(fileInfo) {
  return getPendingUploads().find((item) =>
    item.id === fileInfo.id ||
    (item.name === fileInfo.name && item.size === fileInfo.size && item.lastModified === fileInfo.file.lastModified)
  );
}

function renderPendingNotice() {
  if (sending) {
    resumeAdvice.className = "resume-advice hidden";
    resumeAdviceTitle.textContent = "";
    resumeAdviceText.textContent = "";
    resumeAdvice.removeAttribute("data-pending-id");
    discardResumeButton.disabled = true;
    return;
  }

  const pending = getPendingUploads();

  if (!pending.length) {
    resumeAdvice.className = "resume-advice hidden";
    resumeAdviceTitle.textContent = "";
    resumeAdviceText.textContent = "";
    resumeAdvice.removeAttribute("data-pending-id");
    discardResumeButton.disabled = true;
    return;
  }

  const [latest] = pending;
  resumeAdvice.className = "resume-advice";
  resumeAdvice.dataset.pendingId = latest.id;
  resumeAdviceTitle.textContent = `Envio pausado: ${latest.name}`;
  resumeAdviceText.textContent = `Selecione o mesmo arquivo (${formatBytes(latest.size)}) e toque em Enviar para continuar do ponto salvo.`;
  discardResumeButton.disabled = false;
}

function isHostedSite() {
  const host = window.location.hostname;
  const isLan =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

  return !isLan;
}

function renderSizeAdvice() {
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);

  if (!totalSize) {
    sizeAdvice.className = "size-advice hidden";
    sizeAdviceTitle.textContent = "";
    sizeAdviceText.textContent = "";
    return;
  }

  const hosted = isHostedSite();
  let level = "ok";
  let text = "Tamanho tranquilo. Mantenha esta tela aberta ate concluir.";

  if (totalSize >= 10 * ONE_GB) {
    level = "danger";
    text = hosted
      ? "10 GB ou mais e pesado para o Render gratis. Use a versao local no PC para evitar perda do envio se o servidor reiniciar."
      : "10 GB ou mais pode funcionar localmente, mas depende do Wi-Fi e do espaco livre no PC.";
  } else if (totalSize >= 5 * ONE_GB) {
    level = "danger";
    text = hosted
      ? "Arquivo muito grande para hospedagem gratis. Pode demorar bastante e o parcial pode sumir se o servidor reiniciar."
      : "Arquivo muito grande. Confira o espaco livre no PC e use uma rede Wi-Fi estavel.";
  } else if (totalSize >= ONE_GB) {
    level = "caution";
    text = hosted
      ? "Arquivo grande. No Render gratis, envie em Wi-Fi estavel e baixe assim que terminar."
      : "Arquivo grande. Use Wi-Fi estavel e confira o espaco livre no destino.";
  } else if (totalSize >= 500 * 1024 * 1024) {
    level = "caution";
    text = "Arquivo medio. Evite trocar de rede ou bloquear a tela durante o envio.";
  }

  sizeAdvice.className = `size-advice ${level}`;
  sizeAdviceTitle.textContent = `Total selecionado: ${formatBytes(totalSize)}`;
  sizeAdviceText.textContent = text;
}

function updateQueueSummary() {
  if (!selectedFiles.length) {
    queueSummary.className = "queue-summary hidden";
    queueStep.textContent = "0 de 0";
    queueCurrent.textContent = "Nenhum arquivo selecionado";
    queueNext.textContent = "";
    return;
  }

  const completed = selectedFiles.filter((file) => file.status === "done").length;
  const currentIndex = activeFileIndex >= 0 ? activeFileIndex : Math.min(completed, selectedFiles.length - 1);
  const current = selectedFiles[currentIndex];
  const next = selectedFiles.slice(currentIndex + 1).find((file) => file.status !== "done");
  const verb = sending ? "Enviando" : completed === selectedFiles.length ? "Concluido" : "Pronto";

  queueSummary.className = "queue-summary";
  queueStep.textContent = `${verb} ${Math.min(currentIndex + 1, selectedFiles.length)} de ${selectedFiles.length}`;
  queueCurrent.textContent = current ? current.name : "Fila pronta";
  queueNext.textContent = next ? `Proximo: ${next.name}` : completed === selectedFiles.length ? "Todos os arquivos foram enviados." : "Ultimo arquivo da fila.";
}

function markQueueState() {
  const nextFile = selectedFiles.find((file) => file.status !== "done" && file.id !== activeFileId);

  for (const file of selectedFiles) {
    const item = Array.from(queue.children).find((child) => child.dataset.fileId === file.id);
    if (!item) continue;

    item.classList.toggle("current", file.id === activeFileId);
    item.classList.toggle("next", Boolean(nextFile && file.id === nextFile.id && file.id !== activeFileId));
    item.classList.toggle("done", file.status === "done");
    item.classList.toggle("error", file.status === "error");
  }
}

function renderQueue() {
  queue.innerHTML = "";

  for (const file of selectedFiles) {
    const item = document.createElement("article");
    item.className = `queue-item ${file.status || "queued"}`;
    item.dataset.fileId = file.id;
    item.innerHTML = `
      <header>
        <strong>${escapeHtml(file.name)}</strong>
        <span>${formatBytes(file.size)}</span>
      </header>
      <div class="queue-progress"><span></span></div>
      <div class="queue-meta">
        <span class="queue-status">${file.status === "done" ? "Enviado" : file.status === "error" ? "Pausado" : "Na fila"}</span>
        <span class="queue-eta">--</span>
      </div>
    `;
    queue.append(item);

    if (file.pending) {
      updateItem(file.id, {
        percent: file.size > 0 ? (file.pending.received / file.size) * 100 : 0,
        status: `Pronto para retomar de ${formatBytes(file.pending.received)}`,
        eta: "toque Enviar"
      });
    }
  }

  markQueueState();
  updateQueueSummary();
}

function updateItem(id, patch) {
  const item = Array.from(queue.children).find((child) => child.dataset.fileId === id);
  if (!item) return;

  const fileInfo = selectedFiles.find((file) => file.id === id);
  if (fileInfo && patch.fileStatus) fileInfo.status = patch.fileStatus;
  if (patch.resetClass) {
    item.classList.remove("done", "error", "current", "next");
    if (fileInfo) fileInfo.status = "queued";
  }
  if (patch.className) item.classList.add(patch.className);
  if (patch.percent != null) item.querySelector(".queue-progress span").style.width = `${patch.percent}%`;
  if (patch.status) item.querySelector(".queue-status").textContent = patch.status;
  if (patch.eta) item.querySelector(".queue-eta").textContent = patch.eta;
  markQueueState();
  updateQueueSummary();
}

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "Falha no envio");
    error.received = data.received;
    error.expired = Boolean(data.expired);
    error.pinRequired = Boolean(data.pinRequired);
    throw error;
  }

  return data;
}

async function startUpload(fileInfo) {
  const response = await fetch(authenticatedUrl("/upload/start"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: fileInfo.id,
      fileName: fileInfo.name,
      size: fileInfo.size
    })
  });

  return readJsonResponse(response);
}

async function requestStatus(fileInfo) {
  const response = await fetch(authenticatedUrl(`/upload/status?id=${encodeURIComponent(fileInfo.id)}`));
  return readJsonResponse(response);
}

async function finishUpload(fileInfo) {
  const response = await fetch(authenticatedUrl("/upload/finish"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: fileInfo.id })
  });

  return readJsonResponse(response);
}

async function cancelUploadOnServer(id) {
  if (!id) return;

  await fetch(authenticatedUrl("/upload/cancel"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
}

async function cancelSavedUpload(id) {
  if (!id) return;

  discardResumeButton.disabled = true;
  discardResumeButton.textContent = "Descartando...";

  try {
    await cancelUploadOnServer(id);
  } finally {
    forgetPendingUpload(id);
    selectedFiles = selectedFiles.map((file) => file.id === id ? { ...file, pending: null } : file);
    renderQueue();
    discardResumeButton.textContent = "Descartar salvo";
    discardResumeButton.disabled = false;
  }
}

async function cancelStoppedFile(fileInfo) {
  if (!fileInfo) return;

  try {
    await delay(150);
    await cancelUploadOnServer(fileInfo.id);
  } catch {
    // If the connection dropped, at least remove the local resume marker.
  }

  forgetPendingUpload(fileInfo.id);
  fileInfo.pending = null;
  updateItem(fileInfo.id, {
    status: "Envio parado",
    eta: "cancelado",
    className: "error",
    fileStatus: "error"
  });
}

function updateProgress(fileInfo, received, startedAt, baseOffset) {
  const percent = fileInfo.size > 0 ? Math.min(100, (received / fileInfo.size) * 100) : 100;
  const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
  const speed = Math.max(0, received - baseOffset) / elapsed;
  const remaining = Math.max(0, fileInfo.size - received);
  const eta = remaining > 0 && speed > 0 ? remaining / speed : 0;

  updateItem(fileInfo.id, {
    percent,
    status: `${Math.round(percent)}% · ${formatBytes(speed)}/s`,
    eta: formatTime(eta)
  });
}

function uploadChunk(fileInfo, offset, chunk, startedAt, baseOffset) {
  return new Promise((resolve, reject) => {
    if (stopRequested) {
      reject(createStoppedError());
      return;
    }

    const xhr = new XMLHttpRequest();
    activeChunkRequest = xhr;

    const clearActiveRequest = () => {
      if (activeChunkRequest === xhr) {
        activeChunkRequest = null;
      }
    };

    xhr.open(
      "POST",
      authenticatedUrl(`/upload/chunk?id=${encodeURIComponent(fileInfo.id)}&offset=${encodeURIComponent(offset)}`)
    );
    xhr.setRequestHeader("content-type", "application/octet-stream");

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      updateProgress(fileInfo, offset + event.loaded, startedAt, baseOffset);
    });

    xhr.addEventListener("load", () => {
      clearActiveRequest();
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = { error: xhr.responseText || "Falha no envio" };
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }

      if (xhr.status === 409 && typeof data.received === "number") {
        resolve(data);
        return;
      }

      const error = new Error(data.error || "Falha no envio");
      error.received = data.received;
      reject(error);
    });

    xhr.addEventListener("error", () => {
      clearActiveRequest();
      reject(new Error("Erro de rede"));
    });
    xhr.addEventListener("abort", () => {
      clearActiveRequest();
      reject(stopRequested ? createStoppedError() : new Error("Envio pausado"));
    });
    xhr.send(chunk);
  });
}

async function uploadFile(fileInfo) {
  activeFileId = fileInfo.id;
  activeFileIndex = selectedFiles.findIndex((file) => file.id === fileInfo.id);
  fileInfo.status = "current";
  markQueueState();
  updateQueueSummary();
  updateItem(fileInfo.id, { resetClass: true, fileStatus: "current", status: "Preparando", eta: "--" });

  const start = await startUpload(fileInfo);
  if (stopRequested) throw createStoppedError();

  const chunkSize = Math.max(256 * 1024, Number(start.chunkSize || DEFAULT_CHUNK_SIZE));

  if (start.complete) {
    updateItem(fileInfo.id, {
      percent: 100,
      status: "Ja enviado",
      eta: "concluido",
      className: "done",
      fileStatus: "done"
    });
    return;
  }

  let offset = Math.min(Number(start.received || 0), fileInfo.size);
  const startedAt = Date.now();
  const baseOffset = offset;

  if (offset > 0) {
    updateItem(fileInfo.id, {
      percent: (offset / fileInfo.size) * 100,
      status: `Retomando de ${formatBytes(offset)}`,
      eta: "--"
    });
  }

  rememberPendingUpload(fileInfo, offset);

  while (offset < fileInfo.size) {
    if (stopRequested) throw createStoppedError();

    const end = Math.min(offset + chunkSize, fileInfo.size);
    const chunk = fileInfo.file.slice(offset, end);
    let attempts = 0;

    while (true) {
      try {
        const result = await uploadChunk(fileInfo, offset, chunk, startedAt, baseOffset);
        offset = Math.min(Number(result.received || end), fileInfo.size);
        rememberPendingUpload(fileInfo, offset);
        updateProgress(fileInfo, offset, startedAt, baseOffset);
        break;
      } catch (error) {
        if (error.stopped || stopRequested) {
          throw createStoppedError();
        }

        attempts += 1;

        try {
          const status = await requestStatus(fileInfo);
          if (typeof status.received === "number" && status.received > offset) {
            offset = Math.min(status.received, fileInfo.size);
            break;
          }
        } catch {
          // The next retry will decide whether the connection recovered.
        }

        if (attempts >= MAX_CHUNK_RETRIES) {
          updateItem(fileInfo.id, {
            status: "Pausado - toque Enviar para continuar",
            eta: error.message || "sem conexao",
            className: "error",
            fileStatus: "error"
          });
          throw error;
        }

        updateItem(fileInfo.id, {
          status: `Reconectando (${attempts}/${MAX_CHUNK_RETRIES})`,
          eta: "--"
        });
        await delay(900 * attempts);
      }
    }
  }

  if (stopRequested) throw createStoppedError();

  const finished = await finishUpload(fileInfo);
  const duration = Number(finished.duration || 0);
  const averageSpeed = duration > 0 ? fileInfo.size / duration : 0;
  forgetPendingUpload(fileInfo.id);
  updateItem(fileInfo.id, {
    percent: 100,
    status: duration > 0 ? `Enviado · media ${formatBytes(averageSpeed)}/s` : "Enviado",
    eta: duration > 0 ? `terminou em ${formatTime(duration)}` : "concluido",
    className: "done",
    fileStatus: "done"
  });
}

async function selectFiles(fileList, otherInput) {
  if (sending) return;

  sendButton.disabled = true;
  sendButton.textContent = "Preparando...";
  if (otherInput) otherInput.value = "";

  selectedFiles = await Promise.all(
    Array.from(fileList || []).map(async (file) => ({
      id: await createFileId(file),
      file,
      name: fileDisplayName(file),
      size: file.size,
      pending: null,
      status: "queued"
    }))
  );
  selectedFiles = selectedFiles.map((fileInfo) => ({
    ...fileInfo,
    pending: matchingPendingUpload(fileInfo) || null
  }));

  renderQueue();
  renderSizeAdvice();
  renderPendingNotice();
  renderUploadControls();
}

fileInput.addEventListener("change", () => {
  selectFiles(fileInput.files, folderInput);
});

folderInput.addEventListener("change", () => {
  selectFiles(folderInput.files, fileInput);
});

sendButton.addEventListener("click", async () => {
  if (sending || !selectedFiles.length) return;

  sending = true;
  stopRequested = false;
  activeChunkRequest = null;
  renderUploadControls();
  renderPendingNotice();

  for (const fileInfo of selectedFiles) {
    if (stopRequested) break;

    try {
      await uploadFile(fileInfo);
    } catch (error) {
      if (error.expired) {
        showExpiredSession(error.message);
      } else if (error.pinRequired) {
        saveMobileAuthToken("");
        showPinPanel(error.message);
      }
      if (error.stopped || stopRequested) {
        await cancelStoppedFile(fileInfo);
      }
      break;
    }
  }

  sending = false;
  stopRequested = false;
  activeChunkRequest = null;
  activeFileId = null;
  activeFileIndex = -1;
  markQueueState();
  updateQueueSummary();
  renderUploadControls();
  renderPendingNotice();
});

stopButton.addEventListener("click", () => {
  if (!sending || stopRequested) return;

  stopRequested = true;
  renderUploadControls();

  if (activeChunkRequest) {
    activeChunkRequest.abort();
  }
});

discardResumeButton.addEventListener("click", () => {
  cancelSavedUpload(resumeAdvice.dataset.pendingId);
});

pinInput.addEventListener("input", () => {
  pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 6);
  pinMessage.textContent = "";
});

pinInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") verifyPin();
});

pinButton.addEventListener("click", verifyPin);

themeToggle.addEventListener("click", () => {
  const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(currentTheme === "dark" ? "light" : "dark", themeToggle);
});

noteCopyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(sharedNote.value);
  } catch {
    sharedNote.select();
    document.execCommand("copy");
  }

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

sharedNote.addEventListener("input", scheduleNoteSave);
sharedNote.addEventListener("blur", () => {
  clearTimeout(noteSaveTimer);
  saveSharedNote();
});

if (!("webkitdirectory" in folderInput)) {
  folderPicker.classList.add("hidden");
}

async function init() {
  applyTheme(preferredTheme(), themeToggle);
  renderPendingNotice();
  renderUploadControls();
  updateQueueSummary();

  const restored = await verifyStoredAuth();
  if (!restored && !pinInput.disabled) {
    const auto = await tryAutoAuth();
    if (!auto) showPinPanel();
  }
}

init();
