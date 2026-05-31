const status = document.querySelector("#status");
const preview = document.querySelector("#preview");

function sendOffscreenMessage(message) {
  return new Promise((resolve, reject) => {
    const willRespondAsynchronously = offscreenMessageListener(
      {
        target: "x-gif-offscreen",
        ...message
      },
      null,
      resolve
    );

    if (!willRespondAsynchronously && message.type === "CONVERT_X_GIF") {
      reject(new Error("隐藏转换页没有接受编码任务。"));
    }
  });
}

async function runConversionTest() {
  status.textContent = "正在调用扩展隐藏转换页...";
  const conversion = await sendOffscreenMessage({
    type: "CONVERT_X_GIF",
    url: "assets/video-1s.mp4"
  });

  if (!conversion.ok) {
    throw new Error(conversion.error);
  }

  const data = new Uint8Array(await (await fetch(conversion.url)).arrayBuffer());
  const signature = new TextDecoder().decode(data.slice(0, 6));

  if (!["GIF87a", "GIF89a"].includes(signature)) {
    throw new Error(`文件签名不正确：${signature}`);
  }

  preview.src = conversion.url;
  document.body.dataset.result = "ok";
  status.textContent = `转换成功：${signature}，${data.byteLength} 字节`;

  sendOffscreenMessage({
    type: "RELEASE_X_GIF_URL",
    url: conversion.url
  });
}

runConversionTest().catch((error) => {
  document.body.dataset.result = "error";
  status.textContent = `转换失败：${error.message}`;
});
