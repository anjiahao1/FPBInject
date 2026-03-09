#!/usr/bin/env python3

# MIT License
# Copyright (c) 2025 - 2026 _VIFEXTech

"""
Shared SSE (Server-Sent Events) utilities for streaming progress.

Provides a reusable generator and Response builder so that every route
using Thread + Queue + SSE follows the same pattern.
"""

import json
import logging
import queue
import time

from flask import Response

logger = logging.getLogger(__name__)

# Defaults (same as file-transfer, the most mature implementation)
_DEFAULT_POLL_SEC = 5.0
_DEFAULT_INACTIVITY_TIMEOUT = 120.0

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "close",
    "X-Accel-Buffering": "no",
}


def sse_generator(
    progress_queue,
    poll_interval=_DEFAULT_POLL_SEC,
    inactivity_timeout=_DEFAULT_INACTIVITY_TIMEOUT,
):
    """Yield SSE ``data:`` lines from a :class:`queue.Queue`.

    Protocol:
    - ``dict`` items are serialised to JSON and yielded as ``data: ...\\n\\n``.
    - A ``None`` sentinel terminates the stream.
    - On poll timeout a heartbeat is sent; if no activity for
      *inactivity_timeout* seconds an error result is emitted and the
      stream ends.

    Args:
        progress_queue: A :class:`queue.Queue` fed by a worker thread.
        poll_interval: Seconds to block on ``queue.get`` before sending
            a heartbeat.
        inactivity_timeout: Seconds of silence before declaring timeout.
    """
    last_activity = time.time()
    while True:
        try:
            item = progress_queue.get(timeout=poll_interval)
            if item is None:
                break
            last_activity = time.time()
            yield f"data: {json.dumps(item)}\n\n"
        except queue.Empty:
            inactive = time.time() - last_activity
            if inactive > inactivity_timeout:
                yield (
                    f"data: {json.dumps({'type': 'result', 'success': False, 'error': 'Timeout - no activity'})}\n\n"
                )
                break
            yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"


def sse_response(progress_queue, **kwargs):
    """Build a Flask :class:`Response` wrapping :func:`sse_generator`.

    Accepts the same keyword arguments as :func:`sse_generator`.
    """
    return Response(
        sse_generator(progress_queue, **kwargs),
        mimetype="text/event-stream",
        headers=_SSE_HEADERS,
    )
