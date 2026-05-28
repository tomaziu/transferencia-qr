const startScanButton = document.querySelector("#startScanButton");
const stopScanButton = document.querySelector("#stopScanButton");
const scannerShell = document.querySelector("#scannerShell");
const scannerVideo = document.querySelector("#scannerVideo");
const scannerStatus = document.querySelector("#scannerStatus");
const linkInput = document.querySelector("#linkInput");
const openLinkButton = document.querySelector("#openLinkButton");
const entryMessage = document.querySelector("#entryMessage");
const themeToggle = document.querySelector("#themeToggle");

let scanStream = null;
let scanFrameId = 0;
let jsQrReady = null;

function setEntryMessage(text, isError = false) {
  entryMessage.textContent = text || "";
  entryMessage.classList.toggle("error", Boolean(isError && text));
}

function parseSendUrl(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw, window.location.origin);
    const key = url.searchParams.get("key");
    if (!key) return null;

    if (url.pathname !== "/send" && !url.pathname.endsWith("/send")) {
      return null;
    }

    return `/send?key=${encodeURIComponent(key)}`;
  } catch {
    const keyMatch = raw.match(/[?&]key=([^&\s#]+)/i);
    if (!keyMatch) return null;
    return `/send?key=${encodeURIComponent(decodeURIComponent(keyMatch[1]))}`;
  }
}

function goToSendTarget(target) {
  if (!target) {
    setEntryMessage("Link inválido. Use o endereco completo com /send?key=...", true);
    return;
  }

  stopScanner();
  window.location.assign(target);
}

async function ensureJsQR() {
  if (window.jsQR) return window.jsQR;
  if (jsQrReady) return jsQrReady;

  jsQrReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/jsqr.js";
    script.async = true;
    script.onload = () => resolve(window.jsQR);
    script.onerror = () => reject(new Error("Não foi possível carregar o leitor de QR"));
    document.head.append(script);
  });

  return jsQrReady;
}

function stopScanner() {
  if (scanFrameId) {
    cancelAnimationFrame(scanFrameId);
    scanFrameId = 0;
  }

  if (scanStream) {
    for (const track of scanStream.getTracks()) track.stop();
    scanStream = null;
  }

  scannerVideo.srcObject = null;
  scannerShell.classList.add("hidden");
  startScanButton.hidden = false;
}

async function scanWithBarcodeDetector(video) {
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  return new Promise((resolve) => {
    const tick = async () => {
      if (!scanStream) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
          const codes = await detector.detect(canvas);
          if (codes.length) {
            scanFrameId = 0;
            resolve(codes[0].rawValue);
            return;
          }
        } catch {
          // Keep trying on the next frame.
        }
      }

      scanFrameId = requestAnimationFrame(tick);
    };

    scanFrameId = requestAnimationFrame(tick);
  });
}

async function scanWithJsQR(video) {
  const jsQR = await ensureJsQR();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  return new Promise((resolve) => {
    const tick = () => {
      if (!scanStream) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert"
        });

        if (result?.data) {
          scanFrameId = 0;
          resolve(result.data);
          return;
        }
      }

      scanFrameId = requestAnimationFrame(tick);
    };

    scanFrameId = requestAnimationFrame(tick);
  });
}

async function startScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setEntryMessage("Seu navegador não suporta câmera. Cole o link do QR abaixo.", true);
    return;
  }

  setEntryMessage("");
  startScanButton.hidden = true;
  scannerShell.classList.remove("hidden");
  scannerStatus.textContent = "Solicitando permissao da câmera...";

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    scannerVideo.srcObject = scanStream;
    await scannerVideo.play();
    scannerStatus.textContent = "Aponte para o QR Code no computador";

    const canUseBarcodeDetector = "BarcodeDetector" in window;
    const rawValue = canUseBarcodeDetector
      ? await scanWithBarcodeDetector(scannerVideo)
      : await scanWithJsQR(scannerVideo);

    const target = parseSendUrl(rawValue);
    if (!target) {
      scannerStatus.textContent = "QR lido, mas o link não e válido. Tente de novo.";
      stopScanner();
      startScanButton.hidden = false;
      return;
    }

    scannerStatus.textContent = "QR Code encontrado. Abrindo...";
    goToSendTarget(target);
  } catch (error) {
    stopScanner();
    startScanButton.hidden = false;

    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
      setEntryMessage("Permissao da câmera negada. Você pode colar o link do QR abaixo.", true);
      return;
    }

    setEntryMessage(error.message || "Não foi possível abrir a câmera.", true);
  }
}

startScanButton.addEventListener("click", () => {
  startScanner().catch((error) => setEntryMessage(error.message || "Erro ao iniciar a câmera.", true));
});

stopScanButton.addEventListener("click", () => {
  stopScanner();
  startScanButton.hidden = false;
  scannerStatus.textContent = "Câmera fechada.";
});

openLinkButton.addEventListener("click", () => {
  goToSendTarget(parseSendUrl(linkInput.value));
});

linkInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    goToSendTarget(parseSendUrl(linkInput.value));
  }
});

if (themeToggle) {
  applyTheme(preferredTheme(), themeToggle);
  themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme, themeToggle);
  });
}

window.addEventListener("pagehide", stopScanner);

const initialKey = new URLSearchParams(window.location.search).get("key");
if (initialKey) {
  goToSendTarget(`/send?key=${encodeURIComponent(initialKey)}`);
}
