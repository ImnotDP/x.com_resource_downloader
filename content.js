(() => {
  const SCRIPT_MARKER = "__xGifDownloaderInjected";
  const DOWNLOAD_MESSAGE = "DOWNLOAD_X_GIF";
  const DOWNLOAD_VIDEO_MESSAGE = "DOWNLOAD_X_VIDEO";
  const VIDEO_SELECTOR = "video";
  const MEDIA_PLAYER_SELECTOR = '[data-testid="videoPlayer"]';
  const BUTTON_CLASS = "x-gif-download-button";
  const HOST_CLASS = "x-gif-download-host";
  const PROCESSED_ATTRIBUTE = "data-x-gif-download-ready";
  const BUTTON_ATTRIBUTE = "data-x-gif-download-button";
  const GIF_VIDEO_PATH = "/tweet_video/";
  const GIF_THUMB_PATH = "/tweet_video_thumb/";
  const VIDEO_PATHS = ["/ext_tw_video/", "/amplify_video/"];
  const STATUS_RESET_DELAY = 1800;
  const RESCAN_DELAY = 1500;
  const MEDIA_DATA_MESSAGE_KEY = "__xGifDlMediaData";
  const MEDIA_HELLO_MESSAGE_KEY = "__xGifDlMediaHello";
  const buttonsByVideo = new WeakMap();
  const mediaByTweet = new Map();

  if (globalThis[SCRIPT_MARKER]) {
    return;
  }

  globalThis[SCRIPT_MARKER] = true;

  function toUrl(value) {
    if (!value) {
      return null;
    }

    try {
      return new URL(value, window.location.href);
    } catch {
      return null;
    }
  }

  function isGifVideoUrl(value) {
    const url = toUrl(value);
    return Boolean(
      url &&
        url.hostname === "video.twimg.com" &&
        url.pathname.startsWith(GIF_VIDEO_PATH) &&
        url.pathname.toLowerCase().endsWith(".mp4")
    );
  }

  function isGifThumbnailUrl(value) {
    const url = toUrl(value);
    return Boolean(
      url &&
        url.hostname === "pbs.twimg.com" &&
        url.pathname.startsWith(GIF_THUMB_PATH)
    );
  }

  function isXVideoUrl(value) {
    const url = toUrl(value);
    return Boolean(
      url &&
        url.hostname === "video.twimg.com" &&
        VIDEO_PATHS.some((path) => url.pathname.startsWith(path)) &&
        url.pathname.toLowerCase().endsWith(".mp4")
    );
  }

  function getMediaCandidates(video) {
    return [
      video.currentSrc,
      video.src,
      ...Array.from(video.querySelectorAll("source"), (source) => source.src)
    ].filter(Boolean);
  }

  function getTweetIdFromVideo(video) {
    const tweet = video.closest("article");
    const statusLink = tweet?.querySelector('a[href*="/status/"]');
    return statusLink?.href.match(/\/status\/(\d+)/)?.[1] || null;
  }

  function getGifIdFromThumbnail(value) {
    const url = toUrl(value);

    if (!url || !isGifThumbnailUrl(url.href)) {
      return null;
    }

    const filename = url.pathname.split("/").pop() || "";
    return filename.replace(/\.[^.]+$/, "") || null;
  }

  function getGifIdFromVideoUrl(value) {
    const url = toUrl(value);

    if (!url || !isGifVideoUrl(url.href)) {
      return null;
    }

    const filename = url.pathname.split("/").pop() || "";
    return filename.replace(/\.mp4$/i, "") || null;
  }

  function getPerformanceGifUrl(gifId) {
    if (!gifId || typeof performance?.getEntriesByType !== "function") {
      return null;
    }

    const matchingEntry = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => {
        return isGifVideoUrl(name) && getGifIdFromVideoUrl(name) === gifId;
      });

    return matchingEntry || null;
  }

  function deriveGifUrlFromThumbnail(value) {
    const gifId = getGifIdFromThumbnail(value);

    if (!gifId) {
      return null;
    }

    return `https://video.twimg.com/tweet_video/${encodeURIComponent(gifId)}.mp4`;
  }

  function findGifUrl(video) {
    const directUrl = getMediaCandidates(video).find(isGifVideoUrl);

    if (directUrl) {
      return directUrl;
    }

    const gifId = getGifIdFromThumbnail(video.poster);
    const derivedUrl =
      getPerformanceGifUrl(gifId) ||
      deriveGifUrlFromThumbnail(video.poster);

    if (derivedUrl) {
      return derivedUrl;
    }

    const tweetId = getTweetIdFromVideo(video);
    const mediaEntry = tweetId ? mediaByTweet.get(tweetId) : null;

    return mediaEntry?.gif || null;
  }

  function findVideoUrl(video) {
    const directUrl = getMediaCandidates(video).find(isXVideoUrl);

    if (directUrl) {
      return directUrl;
    }

    const tweetId = getTweetIdFromVideo(video);
    const mediaEntry = tweetId ? mediaByTweet.get(tweetId) : null;

    return mediaEntry?.video || null;
  }

  function isGifVideo(video) {
    const tweetId = getTweetIdFromVideo(video);
    const mediaEntry = tweetId ? mediaByTweet.get(tweetId) : null;

    return (
      getMediaCandidates(video).some(isGifVideoUrl) ||
      isGifThumbnailUrl(video.poster) ||
      hasGifBadge(video) ||
      Boolean(mediaEntry?.gif)
    );
  }

  function hasGifBadge(video) {
    const player = video.closest(MEDIA_PLAYER_SELECTOR);

    if (!player) {
      return false;
    }

    return Array.from(player.querySelectorAll("span")).some((span) => {
      return span.textContent?.trim().toUpperCase() === "GIF";
    });
  }

  function getDownloadFilename(video, url) {
    const statusId = getTweetIdFromVideo(video);
    const gifId = getGifIdFromVideoUrl(url);

    if (statusId) {
      return `x-gif-${statusId}.gif`;
    }

    if (gifId) {
      return `x-gif-${gifId}.gif`;
    }

    return `x-gif-${Date.now()}.gif`;
  }

  function getVideoDownloadFilename(video, url) {
    const statusId = getTweetIdFromVideo(video);
    const videoId = toUrl(url)?.pathname.split("/").pop()?.replace(/\.mp4$/i, "");
    const filename = statusId || videoId || Date.now();

    return `x-video-${filename}.mp4`;
  }

  function setButtonStatus(button, label, state = "idle") {
    button.dataset.state = state;
    button.querySelector(".x-gif-download-label").textContent = label;

    if (button.statusTimer) {
      clearTimeout(button.statusTimer);
    }

    if (state !== "idle" && state !== "loading") {
      button.statusTimer = setTimeout(() => {
        setButtonStatus(button, button.defaultLabel);
      }, STATUS_RESET_DELAY);
    }
  }

  function sendDownloadMessage(payload, callback) {
    if (!globalThis.chrome?.runtime?.sendMessage) {
      callback({
        ok: false,
        error: "扩展后台未连接。"
      });
      return;
    }

    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        callback({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      callback(response || {
        ok: false,
        error: "扩展后台没有返回结果。"
      });
    });
  }

  function downloadGif(event, video, button) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const url = findGifUrl(video);

    if (!url) {
      setButtonStatus(button, "未找到 GIF", "error");
      return;
    }

    setButtonStatus(button, "正在转换", "loading");

    sendDownloadMessage(
      {
        type: DOWNLOAD_MESSAGE,
        url,
        filename: getDownloadFilename(video, url)
      },
      (response) => {
        setButtonStatus(
          button,
          response.ok ? "GIF 已下载" : "转换失败",
          response.ok ? "success" : "error"
        );
      }
    );
  }

  function downloadMp4(event, video, button) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const url = findVideoUrl(video);

    if (!url) {
      setButtonStatus(button, "未找到视频", "error");
      return;
    }

    setButtonStatus(button, "正在下载", "loading");

    sendDownloadMessage(
      {
        type: DOWNLOAD_VIDEO_MESSAGE,
        url,
        filename: getVideoDownloadFilename(video, url)
      },
      (response) => {
        setButtonStatus(
          button,
          response.ok ? "MP4 已下载" : "下载失败",
          response.ok ? "success" : "error"
        );
      }
    );
  }

  function createDownloadButton(video, isGif) {
    const label = isGif ? "下载 GIF" : "下载 MP4";
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.setAttribute(BUTTON_ATTRIBUTE, "true");
    button.setAttribute("aria-label", label);
    button.title = label;
    button.defaultLabel = label;
    button.style.cssText = `
      align-items: center;
      background: rgba(15, 20, 25, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.32);
      border-radius: 9999px;
      color: #fff;
      cursor: pointer;
      display: flex;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      font-weight: 700;
      gap: 5px;
      line-height: 18px;
      padding: 7px 10px;
      position: absolute;
      right: 10px;
      top: 10px;
      z-index: 2147483647;
    `;
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.4l2.3 2.29V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"/>
      </svg>
      <span class="x-gif-download-label">${label}</span>
    `;
    button.querySelector("svg").style.cssText = `
      fill: currentColor;
      flex: none;
      height: 16px;
      width: 16px;
    `;

    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      if (isGif) {
        downloadGif(event, video, button);
      } else {
        downloadMp4(event, video, button);
      }
    });

    return button;
  }

  function findButtonHost(video) {
    return video.closest(MEDIA_PLAYER_SELECTOR) || video.parentElement;
  }

  function addDownloadButton(video) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    const isGif = isGifVideo(video);

    if (!isGif && !findVideoUrl(video)) {
      return;
    }

    const host = findButtonHost(video);

    if (!host) {
      return;
    }

    const currentButton = buttonsByVideo.get(video);

    if (currentButton?.isConnected && currentButton.parentElement === host) {
      return;
    }

    const existingButton = Array.from(
      host.querySelectorAll(`:scope > .${BUTTON_CLASS}`)
    ).find((button) => {
      return button.video === video;
    });

    if (existingButton) {
      buttonsByVideo.set(video, existingButton);
      return;
    }

    const button = createDownloadButton(video, isGif);
    button.video = video;
    video.setAttribute(PROCESSED_ATTRIBUTE, "true");
    host.classList.add(HOST_CLASS);

    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }

    host.append(button);
    buttonsByVideo.set(video, button);
  }

  function scanForGifVideos(root = document) {
    if (root instanceof HTMLVideoElement) {
      addDownloadButton(root);
    }

    root.querySelectorAll?.(VIDEO_SELECTOR).forEach(addDownloadButton);
  }

  function handleMediaData(videos) {
    if (!videos || typeof videos !== "object") {
      return;
    }

    for (const [tweetId, entry] of Object.entries(videos)) {
      mediaByTweet.set(tweetId, entry);
    }

    scanForGifVideos();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) {
      return;
    }

    if (event.data[MEDIA_DATA_MESSAGE_KEY]) {
      handleMediaData(event.data.videos);
    }
  });

  window.postMessage(
    {
      [MEDIA_HELLO_MESSAGE_KEY]: true
    },
    "*"
  );

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        scanForGifVideos(mutation.target.parentElement || mutation.target);
        return;
      }

      if (mutation.target instanceof Element) {
        scanForGifVideos(mutation.target);
      }

      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          scanForGifVideos(node);
        }
      });
    });
  });

  // 观察 <html> 元素出现后再注册子树观察器,避免在文档
  // 极早期(documentElement 尚不存在)注册失败。
  let documentObserver = new MutationObserver(() => {
    startObserving();
  });

  documentObserver.observe(document, {
    childList: true
  });

  function startObserving() {
    if (!document.documentElement || observerStarted) {
      return;
    }

    observerStarted = true;

    if (documentObserver) {
      documentObserver.disconnect();
      documentObserver = null;
    }

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["poster", "src"]
    });

    scanForGifVideos();
  }

  let observerStarted = false;

  startObserving();

  document.addEventListener(
    "loadedmetadata",
    (event) => {
      if (event.target instanceof HTMLVideoElement) {
        addDownloadButton(event.target);
      }
    },
    true
  );

  setInterval(() => {
    scanForGifVideos();
  }, RESCAN_DELAY);
})();
