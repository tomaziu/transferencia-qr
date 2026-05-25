const fileInput = document.querySelector("#fileInput");
const sendButton = document.querySelector("#sendButton");
const queue = document.querySelector("#queue");
const sizeAdvice = document.querySelector("#sizeAdvice");
const sizeAdviceTitle = document.querySelector("#sizeAdviceTitle");
const sizeAdviceText = document.querySelector("#sizeAdviceText");
const key = new URLSearchParams(window.location.search).get("key") || "";

const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const MAX_CHUNK_RETRIES = 3;
const ONE_GB = 1024 * 1024 * 1024;

let selectedFiles = [];
let sending = false;

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

function renderQueue() {
  queue.innerHTML = "";

  for (const file of selectedFiles) {
    const item = document.createElement("article");
    item.className = "queue-item";
    item.dataset.fileId = file.id;
    item.innerHTML = `
      <header>
        <strong>${escapeHtml(file.name)}</strong>
        <span>${formatBytes(file.size)}</span>
      </header>
      <div class="queue-progress"><span></span></div>
      <div class="queue-meta">
        <span class="queue-status">Na fila</span>
        <span class="queue-eta">--</span>
      </div>
    `;
    queue.append(item);
  }
}

function updateItem(id, patch) {
  const item = Array.from(queue.children).find((child) => child.dataset.fileId === id);
  if (!item) return;

  if (patch.resetClass) item.classList.remove("done", "error");
  if (patch.className) item.classList.add(patch.className);
  if (patch.percent != null) item.querySelector(".queue-progress span").style.width = `${patch.percent}%`;
  if (patch.status) item.querySelector(".queue-status").textContent = patch.status;
  if (patch.eta) item.querySelector(".queue-eta").textContent = patch.eta;
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
    const xhr = new XMLHttpRequest();

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

    xhr.addEventListener("error", () => reject(new Error("Erro de rede")));
    xhr.addEventListener("abort", () => reject(new Error("Envio pausado")));
    xhr.send(chunk);
  });
}

async function uploadFile(fileInfo) {
  updateItem(fileInfo.id, { resetClass: true, status: "Preparando", eta: "--" });

  const start = await startUpload(fileInfo);
  const chunkSize = Math.max(256 * 1024, Number(start.chunkSize || DEFAULT_CHUNK_SIZE));

  if (start.complete) {
    updateItem(fileInfo.id, {
      percent: 100,
      status: "Ja enviado",
      eta: "concluido",
      className: "done"
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

  while (offset < fileInfo.size) {
    const end = Math.min(offset + chunkSize, fileInfo.size);
    const chunk = fileInfo.file.slice(offset, end);
    let attempts = 0;

    while (true) {
      try {
        const result = await uploadChunk(fileInfo, offset, chunk, startedAt, baseOffset);
        offset = Math.min(Number(result.received || end), fileInfo.size);
        updateProgress(fileInfo, offset, startedAt, baseOffset);
        break;
      } catch (error) {
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
            className: "error"
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

  await finishUpload(fileInfo);
  updateItem(fileInfo.id, {
    percent: 100,
    status: "Enviado",
    eta: "concluido",
    className: "done"
  });
}

fileInput.addEventListener("change", async () => {
  sending = false;
  sendButton.disabled = true;
  sendButton.textContent = "Preparando...";

  selectedFiles = await Promise.all(
    Array.from(fileInput.files || []).map(async (file) => ({
      id: await createFileId(file),
      file,
      name: file.name,
      size: file.size
    }))
  );

  renderQueue();
  renderSizeAdvice();
  sendButton.textContent = "Enviar";
  sendButton.disabled = !selectedFiles.length;
});

sendButton.addEventListener("click", async () => {
  if (sending || !selectedFiles.length) return;

  sending = true;
  sendButton.disabled = true;
  sendButton.textContent = "Enviando...";

  for (const fileInfo of selectedFiles) {
    try {
      await uploadFile(fileInfo);
    } catch {
      break;
    }
  }

  sending = false;
  sendButton.textContent = "Enviar";
  sendButton.disabled = !selectedFiles.length;
});
