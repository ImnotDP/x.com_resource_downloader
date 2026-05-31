const CONVERT_MESSAGE = "CONVERT_X_GIF";
const RELEASE_MESSAGE = "RELEASE_X_GIF_URL";
const OFFSCREEN_TARGET = "x-gif-offscreen";
const OBJECT_URL_LIFETIME = 10 * 60 * 1000;

const ffmpeg = new FFmpegWASM.FFmpeg();
const objectUrls = new Map();
let ffmpegLoading;
let fileSequence = 0;

function getVendorUrl(filename) {
  return chrome.runtime.getURL(`vendor/ffmpeg/${filename}`);
}

async function loadFfmpeg() {
  if (ffmpeg.loaded) {
    return;
  }

  if (!ffmpegLoading) {
    ffmpegLoading = ffmpeg
      .load({
        coreURL: getVendorUrl("ffmpeg-core.js"),
        wasmURL: getVendorUrl("ffmpeg-core.wasm")
      })
      .catch((error) => {
        ffmpegLoading = null;
        throw error;
      });
  }

  await ffmpegLoading;
}

async function deleteFile(path) {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Ignore cleanup errors because the conversion result is already known.
  }
}

function rememberObjectUrl(url) {
  const timeout = setTimeout(() => {
    releaseObjectUrl(url);
  }, OBJECT_URL_LIFETIME);

  objectUrls.set(url, timeout);
}

function releaseObjectUrl(url) {
  const timeout = objectUrls.get(url);

  if (!timeout) {
    return;
  }

  clearTimeout(timeout);
  objectUrls.delete(url);
  URL.revokeObjectURL(url);
}

async function convertToGif(url) {
  await loadFfmpeg();

  const id = `${Date.now()}-${fileSequence++}`;
  const inputPath = `input-${id}.mp4`;
  const outputPath = `output-${id}.gif`;

  try {
    const response = await fetch(url, {
      credentials: "omit"
    });

    if (!response.ok) {
      throw new Error(`媒体下载失败：HTTP ${response.status}`);
    }

    await ffmpeg.writeFile(inputPath, new Uint8Array(await response.arrayBuffer()));

    const exitCode = await ffmpeg.exec([
      "-i",
      inputPath,
      "-vf",
      "fps=12,scale='min(640,iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
      "-loop",
      "0",
      outputPath
    ]);

    if (exitCode !== 0) {
      throw new Error("GIF 编码失败。");
    }

    const data = await ffmpeg.readFile(outputPath);
    const objectUrl = URL.createObjectURL(
      new Blob([data.buffer], {
        type: "image/gif"
      })
    );

    rememberObjectUrl(objectUrl);
    return objectUrl;
  } finally {
    await deleteFile(inputPath);
    await deleteFile(outputPath);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_TARGET) {
    return false;
  }

  if (message.type === RELEASE_MESSAGE) {
    releaseObjectUrl(message.url);
    sendResponse({
      ok: true
    });
    return false;
  }

  if (message.type !== CONVERT_MESSAGE) {
    return false;
  }

  convertToGif(message.url)
    .then((url) => {
      sendResponse({
        ok: true,
        url
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
