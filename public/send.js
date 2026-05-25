const fileInput = document.querySelector("#fileInput");
const sendButton = document.querySelector("#sendButton");
const queue = document.querySelector("#queue");
const key = new URLSearchParams(window.location.search).get("key") || "";

let selectedFiles = [];
let sending = false;

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

  if (patch.className) item.classList.add(patch.className);
  if (patch.percent != null) item.querySelector(".queue-progress span").style.width = `${patch.percent}%`;
  if (patch.status) item.querySelector(".queue-status").textContent = patch.status;
  if (patch.eta) item.querySelector(".queue-eta").textContent = patch.eta;
}

function uploadFile(fileInfo) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startedAt = Date.now();

    xhr.open("POST", `/upload?key=${encodeURIComponent(key)}&id=${encodeURIComponent(fileInfo.id)}`);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(fileInfo.name));
    xhr.setRequestHeader("content-type", fileInfo.file.type || "application/octet-stream");

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;

      const percent = Math.min(100, (event.loaded / event.total) * 100);
      const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
      const speed = event.loaded / elapsed;
      const remaining = Math.max(0, event.total - event.loaded);
      const eta = remaining > 0 && speed > 0 ? remaining / speed : 0;

      updateItem(fileInfo.id, {
        percent,
        status: `${Math.round(percent)}% · ${formatBytes(speed)}/s`,
        eta: formatTime(eta)
      });
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        updateItem(fileInfo.id, {
          percent: 100,
          status: "Enviado",
          eta: "concluido",
          className: "done"
        });
        resolve();
        return;
      }

      updateItem(fileInfo.id, {
        status: "Falhou",
        eta: xhr.responseText || "erro",
        className: "error"
      });
      reject(new Error(xhr.responseText || "Falha no envio"));
    });

    xhr.addEventListener("error", () => {
      updateItem(fileInfo.id, {
        status: "Falhou",
        eta: "sem conexao",
        className: "error"
      });
      reject(new Error("Erro de rede"));
    });

    updateItem(fileInfo.id, { status: "Enviando", eta: "--" });
    xhr.send(fileInfo.file);
  });
}

fileInput.addEventListener("change", () => {
  selectedFiles = Array.from(fileInput.files || []).map((file) => ({
    id: createId(),
    file,
    name: file.name,
    size: file.size
  }));
  sendButton.disabled = !selectedFiles.length || sending;
  renderQueue();
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
