/*========================================
  FPBInject Workbench - SSE Stream Utilities
  ========================================*/

/**
 * Consume an SSE (Server-Sent Events) stream from a fetch response.
 *
 * Uses fetch + ReadableStream (not EventSource) so that POST requests
 * and AbortController cancellation are supported.
 *
 * @param {string} url        - API endpoint
 * @param {Object} options    - fetch options (method, headers, body, ...)
 * @param {Object} handlers   - Event handlers keyed by SSE event type:
 *   {
 *     onProgress(data),   // {type:"progress", ...}
 *     onStatus(data),     // {type:"status", ...}
 *     onResult(data),     // {type:"result", ...}
 *     onLog(data),        // {type:"log", ...}
 *     onOther(data),      // any other type
 *   }
 * @param {AbortController} [abortCtrl] - Optional controller to cancel the stream
 * @returns {Promise<Object|null>} The final "result" event data, or null
 */
async function consumeSSEStream(url, options, handlers, abortCtrl) {
  const response = await fetch(url, {
    ...options,
    signal: abortCtrl?.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        switch (data.type) {
          case 'progress':
            handlers.onProgress?.(data);
            break;
          case 'status':
            handlers.onStatus?.(data);
            break;
          case 'result':
            finalResult = data;
            handlers.onResult?.(data);
            break;
          case 'log':
            handlers.onLog?.(data);
            break;
          case 'heartbeat':
            break;
          default:
            handlers.onOther?.(data);
        }
      } catch (e) {
        console.warn('Failed to parse SSE data:', line, e);
      }
    }
  }

  return finalResult;
}

// Export for global access
window.consumeSSEStream = consumeSSEStream;
