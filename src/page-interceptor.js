(() => {
  if (window.__TT_AUTO_SCREENER_INTERCEPTOR__) return;
  window.__TT_AUTO_SCREENER_INTERCEPTOR__ = true;

  const API_PATTERN = /\/api\/|item_list|\/search\/|\/recommend\//i;
  const TARGET_PATTERN = /item_list|post\/item_list|search\/item|recommend\/item_list|feed\/|explore/i;

  function shouldCapture(url) {
    const value = String(url || '');
    return API_PATTERN.test(value) && TARGET_PATTERN.test(value);
  }

  function postApiResponse(url, payload) {
    window.postMessage({
      source: 'TT_AUTO_SCREENER_PAGE',
      type: 'API_RESPONSE',
      url: String(url || location.href),
      payload,
    }, '*');
  }

  function parseAndPost(url, text) {
    if (!shouldCapture(url) || !text) return;
    try {
      postApiResponse(url, JSON.parse(text));
    } catch (error) {}
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function patchedFetch(input) {
      const response = await originalFetch.apply(this, arguments);
      const url = typeof input === 'string' ? input : input?.url;
      if (shouldCapture(url)) {
        response.clone().text()
          .then((text) => parseAndPost(url, text))
          .catch(() => {});
      }
      return response;
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (typeof OriginalXHR === 'function') {
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function patchedOpen() {
      const url = arguments[1];
      this.__ttAutoScreenerUrl = url;
      return originalOpen.apply(this, arguments);
    };

    OriginalXHR.prototype.send = function patchedSend() {
      this.addEventListener('load', () => {
        const url = this.__ttAutoScreenerUrl || this.responseURL;
        if (!shouldCapture(url)) return;
        if (typeof this.responseText === 'string') parseAndPost(url, this.responseText);
      });
      return originalSend.apply(this, arguments);
    };
  }
})();
