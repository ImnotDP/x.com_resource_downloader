let offscreenMessageListener;

globalThis.chrome = {
  runtime: {
    getURL(path) {
      return new URL(`../${path}`, window.location.href).href;
    },
    onMessage: {
      addListener(listener) {
        offscreenMessageListener = listener;
      }
    }
  }
};
