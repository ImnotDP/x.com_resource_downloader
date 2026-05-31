const DOWNLOAD_MESSAGE = "DOWNLOAD_X_GIF";
const CONVERT_MESSAGE = "CONVERT_X_GIF";
const RELEASE_MESSAGE = "RELEASE_X_GIF_URL";
const OFFSCREEN_TARGET = "x-gif-offscreen";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const TRUSTED_MEDIA_HOST = "video.twimg.com";
const TRUSTED_MEDIA_PREFIX = "/tweet_video/";
const DOWNLOAD_URL_FALLBACK_LIFETIME = 10 * 60 * 1000;

let creatingOffscreenDocument;
let conversionQueue = Promise.resolve();
const downloadUrls = new Map();

function getTrustedGifUrl(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.hostname !== TRUSTED_MEDIA_HOST ||
      !url.pathname.startsWith(TRUSTED_MEDIA_PREFIX) ||
      !url.pathname.toLowerCase().endsWith(".mp4")
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function getSafeFilename(value) {
  const fallback = `x-gif-${Date.now()}.gif`;
  const filename = typeof value === "string" ? value.trim() : "";

  if (!filename) {
    return fallback;
  }

  const sanitized = filename
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);

  if (!sanitized) {
    return fallback;
  }

  return `${
    sanitized.replace(/\.(?:gif|mp4)$/i, "") || `x-gif-${Date.now()}`
  }.gif`;
}

async function hasOffscreenDocument() {
  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });

    return contexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some((client) => {
    return client.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  });
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["BLOBS", "WORKERS"],
        justification: "将 X 上的循环 MP4 转换为可下载的 GIF 文件。"
      })
      .finally(() => {
        creatingOffscreenDocument = null;
      });
  }

  await creatingOffscreenDocument;
}

function sendOffscreenMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        target: OFFSCREEN_TARGET,
        ...message
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      }
    );
  });
}

function releaseDownloadUrl(url) {
  if (!url) {
    return;
  }

  downloadUrls.delete(url);
  sendOffscreenMessage({
    type: RELEASE_MESSAGE,
    url
  }).catch(() => {});
}

function rememberDownloadUrl(downloadId, url) {
  downloadUrls.set(url, downloadId);

  setTimeout(() => {
    releaseDownloadUrl(url);
  }, DOWNLOAD_URL_FALLBACK_LIFETIME);
}

function downloadConvertedGif(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: getSafeFilename(filename),
        conflictAction: "uniquify",
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        rememberDownloadUrl(downloadId, url);
        resolve(downloadId);
      }
    );
  });
}

async function convertAndDownload(url, filename) {
  await setupOffscreenDocument();

  const conversion = await sendOffscreenMessage({
    type: CONVERT_MESSAGE,
    url
  });

  if (!conversion?.ok || !conversion.url) {
    throw new Error(conversion?.error || "GIF 转换失败。");
  }

  try {
    return await downloadConvertedGif(conversion.url, filename);
  } catch (error) {
    releaseDownloadUrl(conversion.url);
    throw error;
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state || !["complete", "interrupted"].includes(delta.state.current)) {
    return;
  }

  for (const [url, downloadId] of downloadUrls) {
    if (downloadId === delta.id) {
      releaseDownloadUrl(url);
      break;
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== DOWNLOAD_MESSAGE || message.target === OFFSCREEN_TARGET) {
    return false;
  }

  const url = getTrustedGifUrl(message.url);

  if (!url) {
    sendResponse({
      ok: false,
      error: "没有找到可下载的 GIF 视频地址。"
    });
    return false;
  }

  conversionQueue = conversionQueue
    .catch(() => {})
    .then(() => convertAndDownload(url, message.filename));

  conversionQueue
    .then((downloadId) => {
      sendResponse({
        ok: true,
        downloadId
      });
    })
    .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message
        });
    });

  return true;
});
