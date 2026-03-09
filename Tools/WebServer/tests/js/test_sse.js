/**
 * Tests for core/sse.js - consumeSSEStream utility
 */
const {
  describe,
  it,
  assertEqual,
  assertTrue,
  assertFalse,
} = require('./framework');
const { resetMocks, setFetchResponse, getFetchCalls } = require('./mocks');

module.exports = function (w) {
  describe('SSE Stream Utilities (core/sse.js)', () => {
    it('consumeSSEStream is a function', () =>
      assertTrue(typeof w.consumeSSEStream === 'function'));

    it('consumeSSEStream is async', () =>
      assertEqual(w.consumeSSEStream.constructor.name, 'AsyncFunction'));

    it('parses progress events', async () => {
      setFetchResponse('/api/test/stream', {
        _stream: ['data: {"type":"progress","pct":50}\n\n'],
      });

      const events = [];
      await w.consumeSSEStream(
        '/api/test/stream',
        { method: 'POST' },
        { onProgress: (d) => events.push(d) },
      );

      assertEqual(events.length, 1);
      assertEqual(events[0].type, 'progress');
      assertEqual(events[0].pct, 50);
    });

    it('parses status events', async () => {
      setFetchResponse('/api/test/stream', {
        _stream: ['data: {"type":"status","stage":"compiling"}\n\n'],
      });

      const events = [];
      await w.consumeSSEStream(
        '/api/test/stream',
        {},
        { onStatus: (d) => events.push(d) },
      );

      assertEqual(events.length, 1);
      assertEqual(events[0].stage, 'compiling');
    });

    it('parses result events and returns final result', async () => {
      setFetchResponse('/api/test/stream', {
        _stream: ['data: {"type":"result","success":true,"slot":0}\n\n'],
      });

      let resultEvt = null;
      const final = await w.consumeSSEStream(
        '/api/test/stream',
        {},
        {
          onResult: (d) => {
            resultEvt = d;
          },
        },
      );

      assertTrue(final !== null);
      assertTrue(final.success);
      assertEqual(final.slot, 0);
      assertTrue(resultEvt !== null);
    });

    it('handles multiple events in sequence', async () => {
      setFetchResponse('/api/test/stream', {
        _stream: [
          'data: {"type":"status","stage":"reading"}\n\n',
          'data: {"type":"progress","pct":50}\n\ndata: {"type":"progress","pct":100}\n\n',
          'data: {"type":"result","success":true}\n\n',
        ],
      });

      const statuses = [];
      const progresses = [];
      let result = null;

      await w.consumeSSEStream(
        '/api/test/stream',
        {},
        {
          onStatus: (d) => statuses.push(d),
          onProgress: (d) => progresses.push(d),
          onResult: (d) => {
            result = d;
          },
        },
      );

      assertEqual(statuses.length, 1);
      assertEqual(progresses.length, 2);
      assertTrue(result !== null);
      assertTrue(result.success);
    });

    it('ignores heartbeat events', async () => {
      setFetchResponse('/api/test/stream', {
        _stream: [
          'data: {"type":"heartbeat"}\n\ndata: {"type":"result","success":true}\n\n',
        ],
      });

      const all = [];
      await w.consumeSSEStream(
        '/api/test/stream',
        {},
        {
          onProgress: (d) => all.push(d),
          onStatus: (d) => all.push(d),
          onResult: (d) => all.push(d),
        },
      );

      // Only result, heartbeat is silently ignored
      assertEqual(all.length, 1);
      assertEqual(all[0].type, 'result');
    });

    it('calls onOther for unknown event types', async () => {
      setFetchResponse('/api/test/stream', {
        _stream: ['data: {"type":"custom","value":42}\n\n'],
      });

      const others = [];
      await w.consumeSSEStream(
        '/api/test/stream',
        {},
        { onOther: (d) => others.push(d) },
      );

      assertEqual(others.length, 1);
      assertEqual(others[0].type, 'custom');
      assertEqual(others[0].value, 42);
    });

    it('handles log events', async () => {
      setFetchResponse('/api/test/stream', {
        _stream: ['data: {"type":"log","message":"hello"}\n\n'],
      });

      const logs = [];
      await w.consumeSSEStream(
        '/api/test/stream',
        {},
        { onLog: (d) => logs.push(d) },
      );

      assertEqual(logs.length, 1);
      assertEqual(logs[0].message, 'hello');
    });

    it('throws on non-ok response', async () => {
      setFetchResponse('/api/test/stream', {
        _ok: false,
        _status: 500,
      });

      let caught = false;
      try {
        await w.consumeSSEStream('/api/test/stream', {}, {});
      } catch (e) {
        caught = true;
        assertTrue(e.message.includes('500'));
      }
      assertTrue(caught);
    });

    it('returns null when no result event', async () => {
      setFetchResponse('/api/test/stream', {
        _stream: ['data: {"type":"progress","pct":100}\n\n'],
      });

      const final = await w.consumeSSEStream('/api/test/stream', {}, {});

      assertEqual(final, null);
    });

    it('passes AbortController signal to fetch', async () => {
      setFetchResponse('/api/test/stream', {
        _stream: ['data: {"type":"result","success":true}\n\n'],
      });

      const ctrl = { signal: 'mock-signal' };
      await w.consumeSSEStream('/api/test/stream', {}, {}, ctrl);

      const calls = getFetchCalls();
      const lastCall = calls[calls.length - 1];
      assertEqual(lastCall.options.signal, 'mock-signal');
    });
  });
};
