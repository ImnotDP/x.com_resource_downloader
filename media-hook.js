// X GIF 下载器 —— 页面数据抓取脚本(Main world)
//
// X 新版前端把推文数据放在服务端渲染的流式 <script> 块中:
//   <script nonce="...">($R=>$R[i].next($R[j]={kind:"...",key:"hash{json}"}}))($R["tsr"]);document.currentScript.remove()</script>
// 这些脚本执行后会自我删除,React 水合后 DOM 中不再保留数据;
// 滚动加载的新推文则通过 api.x.com 的 fetch/XHR 返回。
// 本脚本在页面主世界里:
//   1. 抢在脚本自我删除前,通过 MutationObserver 读取新增 script 的内容;
//   2. 拦截 fetch/XHR 响应,提取后续加载的推文数据;
//   3. 解析出「推文 ID → 视频地址」映射,通过 window.postMessage
//      发送给隔离世界里的 content.js。
(() => {
  const SCRIPT_MARKER = "__xGifDlMediaHook";
  const DATA_MESSAGE_KEY = "__xGifDlMediaData";
  const HELLO_MESSAGE_KEY = "__xGifDlMediaHello";
  const API_HOST_PATTERN = /api\.(x|twitter)\.com/;
  const MP4_PATHS = /\/tweet_video\/|\/ext_tw_video\/|\/amplify_video\//;
  const RESCAN_INTERVAL = 3000;

  if (globalThis[SCRIPT_MARKER]) {
    return;
  }

  globalThis[SCRIPT_MARKER] = true;

  const videosByTweet = new Map();
  const processedScripts = new WeakSet();

  function pushToContentScript() {
    const videos = {};

    for (const [tweetId, entry] of videosByTweet) {
      videos[tweetId] = entry;
    }

    window.postMessage(
      {
        [DATA_MESSAGE_KEY]: true,
        videos
      },
      "*"
    );
  }

  function collectFromJson(data) {
    const stack = [];
    let found = false;

    const extractTweetId = (node) => {
      if (typeof node.rest_id === "string" && /^\d+$/.test(node.rest_id)) {
        return node.rest_id;
      }

      // media 对象自身也带 id_str,但它同时含 video_info,
      // 因此只有不含 video_info 的 id_str 才视为推文 ID。
      if (
        !node.video_info &&
        typeof node.id_str === "string" &&
        /^\d+$/.test(node.id_str)
      ) {
        return node.id_str;
      }

      // 新版 X 把推文 ID 编码成 base64("Tweet:<id>")放在 id 字段。
      if (typeof node.id === "string" && node.id.length > 8) {
        try {
          const decoded = atob(node.id);
          const match = decoded.match(/^Tweet:(\d+)/);

          if (match) {
            return match[1];
          }
        } catch {
          // 非 base64 值,忽略。
        }
      }

      return null;
    };

    const walk = (node) => {
      if (!node || typeof node !== "object") {
        return;
      }

      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }

      const tweetId = extractTweetId(node);
      const hasId = typeof tweetId === "string" && tweetId.length > 0;

      if (hasId) {
        stack.push(tweetId);
      }

      const videoInfo = node.video_info;

      if (videoInfo && Array.isArray(videoInfo.variants) && stack.length) {
        const ownerId = stack[stack.length - 1];
        const entry = videosByTweet.get(ownerId) || {
          video: null,
          videoBitrate: -1,
          gif: null
        };

        for (const variant of videoInfo.variants) {
          if (variant?.content_type !== "video/mp4") {
            continue;
          }

          const url = typeof variant.url === "string" ? variant.url : "";

          if (!url || !MP4_PATHS.test(url)) {
            continue;
          }

          if (url.includes("/tweet_video/")) {
            if (!entry.gif) {
              entry.gif = url;
            }
          } else if (
            typeof variant.bitrate === "number" &&
            variant.bitrate > entry.videoBitrate
          ) {
            entry.video = url;
            entry.videoBitrate = variant.bitrate;
          } else if (!entry.video) {
            entry.video = url;
          }
        }

        videosByTweet.set(ownerId, entry);
        found = true;
      }

      for (const key of Object.keys(node)) {
        walk(node[key]);
      }

      if (hasId) {
        stack.pop();
      }
    };

    walk(data);

    if (found) {
      pushToContentScript();
    }
  }

  function collectFromSsrPayload(payloadText) {
    const start = payloadText.indexOf("{");

    if (start < 0) {
      return;
    }

    let payload;

    try {
      payload = JSON.parse(payloadText.slice(start));
    } catch {
      return;
    }

    collectFromJson(payload);
  }

  function handleJsonText(text) {
    if (!text) {
      return;
    }

    // 1) 纯 JSON(api.x.com 的响应)。
    try {
      collectFromJson(JSON.parse(text));
      return;
    } catch {
      // 不是纯 JSON,继续尝试 SSR 数据块格式。
    }

    // 2) X SSR 数据块,含两种载荷:
    //      key:"hash{json}"                     —— 页面/查询元数据
    //      result:$R[i]={kind:"Result.Ok",value:"{\"data\":...}"} —— 推文数据
    //    均为 JS 字符串字面量,先反转义,再解析其中的 JSON。
    const payloadPattern = /(?:key|value):\s*"((?:[^"\\]|\\.)*)"/g;
    let match;

    while ((match = payloadPattern.exec(text))) {
      let decoded;

      try {
        decoded = JSON.parse(`"${match[1]}"`);
      } catch {
        continue;
      }

      collectFromSsrPayload(decoded);
    }
  }

  function scanScriptNodes(root = document) {
    root.querySelectorAll?.("script:not([src])").forEach((node) => {
      if (processedScripts.has(node)) {
        return;
      }

      processedScripts.add(node);
      handleJsonText(node.textContent);
    });
  }

  function scanAddedNodes(nodes) {
    nodes.forEach((node) => {
      if (
        node instanceof HTMLScriptElement &&
        !node.src &&
        !processedScripts.has(node)
      ) {
        processedScripts.add(node);
        handleJsonText(node.textContent);
      }
    });
  }

  const subtreeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      scanAddedNodes(mutation.addedNodes);
    });
  });

  function observeDocumentRoot() {
    if (documentObserver) {
      documentObserver.disconnect();
      documentObserver = null;
    }

    if (!document.documentElement) {
      return;
    }

    subtreeObserver.observe(document.documentElement, {
      subtree: true,
      childList: true
    });

    scanScriptNodes();
  }

  // document 级观察:等 <html> 元素出现后立刻切换到子树观察,
  // 以尽早捕获 SSR 数据块(它们解析后会自我删除)。
  let documentObserver = new MutationObserver(() => {
    observeDocumentRoot();
  });

  documentObserver.observe(document, {
    childList: true
  });

  observeDocumentRoot();

  window.addEventListener("DOMContentLoaded", () => {
    observeDocumentRoot();
  });

  // 兜底:定期重扫(SPA 路由切换或遗漏的脚本)。
  setInterval(() => {
    scanScriptNodes();
  }, RESCAN_INTERVAL);

  // 拦截 fetch:捕获 api.x.com / api.twitter.com 的 JSON 响应。
  const originalFetch = window.fetch;

  if (typeof originalFetch === "function") {
    window.fetch = async function (...args) {
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
      const response = await originalFetch.apply(this, args);

      try {
        if (response?.clone && API_HOST_PATTERN.test(String(requestUrl))) {
          response
            .clone()
            .text()
            .then((text) => {
              handleJsonText(text);
            })
            .catch(() => {});
        }
      } catch {
        // 忽略 hook 自身的错误,不影响页面。
      }

      return response;
    };
  }

  // 兜底:SSR 数据块执行到 document.currentScript.remove() 时,
  // 即使 MutationObserver 错过了节点,也能在移除前抓取内容。
  const originalRemove = Element.prototype.remove;

  Element.prototype.remove = function () {
    if (
      this instanceof HTMLScriptElement &&
      !this.src &&
      !processedScripts.has(this)
    ) {
      processedScripts.add(this);
      handleJsonText(this.textContent);
    }

    return originalRemove.apply(this, arguments);
  };

  // 拦截 XHR:捕获 api.x.com / api.twitter.com 的 JSON 响应。
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xGifDlUrl = String(url);
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      const requestUrl = this.__xGifDlUrl || "";

      if (API_HOST_PATTERN.test(requestUrl)) {
        handleJsonText(this.responseText);
      }
    });

    return originalSend.apply(this, arguments);
  };

  // 隔离世界的 content.js 初始化时会发握手消息,收到后回传当前数据。
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) {
      return;
    }

    if (event.data[HELLO_MESSAGE_KEY]) {
      pushToContentScript();
    }
  });
})();
