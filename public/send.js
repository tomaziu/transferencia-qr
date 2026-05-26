const fileInput = document.querySelector("#fileInput");
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
const key = new URLSearchParams(window.location.search).get("key") || "";

const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const MAX_CHUNK_RETRIES = 3;
const ONE_GB = 1024 * 1024 * 1024;
const PENDING_UPLOADS_KEY = `transferenciaQrPendingUploads:${key.slice(0, 16) || "default"}`;

let selectedFiles = [];
let sending = false;
let activeFileId = null;
let activeFileIndex = -1;
let activeChunkRequest = null;
let stopRequested = false;

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createFileId(file) {
  const source = `${file.name}|${file.size}|${file.lastModified}`;

  if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
    const bytes = new TextEncoder().encode(source);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return createId();
}

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
  return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, "0")}min`;
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
    return;
  }

  sendButton.textContent = "Enviar";
  sendButton.disabled = !selectedFiles.length;
  stopButton.hidden = true;
  stopButton.disabled = true;
  stopButton.textContent = "Parar";
  fileInput.disabled = false;
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
    throw error;
  }

  return data;
}

async function startUpload(fileInfo) {
  const response = await fetch(`/upload/start?key=${encodeURIComponent(key)}`, {
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
  const response = await fetch(`/upload/status?key=${encodeURIComponent(key)}&id=${encodeURIComponent(fileInfo.id)}`);
  return readJsonResponse(response);
}

async function finishUpload(fileInfo) {
  const response = await fetch(`/upload/finish?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: fileInfo.id })
  });

  return readJsonResponse(response);
}

async function cancelUploadOnServer(id) {
  if (!id) return;

  await fetch(`/upload/cancel?key=${encodeURIComponent(key)}`, {
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
      `/upload/chunk?key=${encodeURIComponent(key)}&id=${encodeURIComponent(fileInfo.id)}&offset=${encodeURIComponent(offset)}`
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

  await finishUpload(fileInfo);
  forgetPendingUpload(fileInfo.id);
  updateItem(fileInfo.id, {
    percent: 100,
    status: "Enviado",
    eta: "concluido",
    className: "done",
    fileStatus: "done"
  });
}

fileInput.addEventListener("change", async () => {
  if (sending) return;

  sendButton.disabled = true;
  sendButton.textContent = "Preparando...";

  selectedFiles = await Promise.all(
    Array.from(fileInput.files || []).map(async (file) => ({
      id: await createFileId(file),
      file,
      name: file.name,
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

renderPendingNotice();
renderUploadControls();
updateQueueSummary();
