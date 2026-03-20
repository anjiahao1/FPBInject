#!/usr/bin/env python3

# MIT License
# Copyright (c) 2025 - 2026 _VIFEXTech

"""
WebServer proxy for CLI coexistence.

When the WebServer is running, CLI device operations are forwarded
via HTTP API instead of opening a second serial connection.

If the WebServer is not running, the proxy can auto-launch it as a
background subprocess so the CLI always operates in proxy mode.
"""

import json
import logging
import os
import subprocess
import sys
import time
from typing import Any, Dict, Optional
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

# Default WebServer URL
DEFAULT_SERVER_URL = "http://127.0.0.1:5500"

# Timeout for probe / API calls (seconds)
_PROBE_TIMEOUT = 2
_API_TIMEOUT = 30

# Auto-launch settings
_LAUNCH_TIMEOUT = 10  # Max seconds to wait for server startup
_LAUNCH_POLL_INTERVAL = 0.3  # Poll interval during startup wait


class ServerProxy:
    """Proxy device operations through the running WebServer HTTP API."""

    def __init__(
        self,
        base_url: str = DEFAULT_SERVER_URL,
        token: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._server_process = None  # Tracks auto-launched subprocess

    # ------------------------------------------------------------------
    # Low-level HTTP helpers (stdlib only, no requests dependency)
    # ------------------------------------------------------------------

    def _build_url(self, path: str) -> str:
        url = f"{self.base_url}{path}"
        if self.token:
            sep = "&" if "?" in url else "?"
            url += f"{sep}token={self.token}"
        return url

    def _get(self, path: str, timeout: float = _API_TIMEOUT) -> dict:
        url = self._build_url(path)
        req = Request(url, method="GET")
        req.add_header("Accept", "application/json")
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())

    def _post(
        self, path: str, data: Optional[dict] = None, timeout: float = _API_TIMEOUT
    ) -> dict:
        url = self._build_url(path)
        body = json.dumps(data or {}).encode()
        req = Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())

    # ------------------------------------------------------------------
    # Server detection & auto-launch
    # ------------------------------------------------------------------

    def is_server_running(self) -> bool:
        """Check if the WebServer is reachable."""
        try:
            resp = self._get("/api/status", timeout=_PROBE_TIMEOUT)
            return resp.get("success", False)
        except Exception:
            return False

    def is_device_connected(self) -> bool:
        """Check if the WebServer has an active device connection."""
        try:
            resp = self._get("/api/status", timeout=_PROBE_TIMEOUT)
            return resp.get("connected", False)
        except Exception:
            return False

    def get_status(self) -> dict:
        """Get full WebServer status."""
        return self._get("/api/status")

    def ensure_server(self) -> bool:
        """Ensure the WebServer is running, auto-launching if needed.

        Returns True if server is reachable after this call.
        """
        if self.is_server_running():
            return True

        return self.launch_server()

    def launch_server(self) -> bool:
        """Launch WebServer as a background subprocess.

        Starts main.py with --no-browser --no-auth flags and waits
        until the server responds to /api/status.

        Returns True if server started successfully.
        """
        # Determine main.py path relative to this file
        webserver_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        main_py = os.path.join(webserver_dir, "main.py")

        if not os.path.exists(main_py):
            logger.error(f"WebServer main.py not found: {main_py}")
            return False

        # Parse port from base_url
        try:
            from urllib.parse import urlparse

            parsed = urlparse(self.base_url)
            port = parsed.port or 5500
        except Exception:
            port = 5500

        cmd = [
            sys.executable,
            main_py,
            "--no-browser",
            "--no-auth",
            "--port",
            str(port),
        ]

        logger.info(f"Auto-launching WebServer: {' '.join(cmd)}")

        try:
            self._server_process = subprocess.Popen(
                cmd,
                cwd=webserver_dir,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            logger.error(f"Failed to launch WebServer: {e}")
            return False

        # Wait for server to become reachable
        deadline = time.time() + _LAUNCH_TIMEOUT
        while time.time() < deadline:
            # Check if process died
            if self._server_process.poll() is not None:
                logger.error(
                    f"WebServer process exited with code {self._server_process.returncode}"
                )
                self._server_process = None
                return False

            if self.is_server_running():
                logger.info("WebServer is ready")
                return True

            time.sleep(_LAUNCH_POLL_INTERVAL)

        logger.error(f"WebServer did not start within {_LAUNCH_TIMEOUT}s")
        # Kill the hung process
        try:
            self._server_process.terminate()
        except Exception:
            pass
        self._server_process = None
        return False

    # ------------------------------------------------------------------
    # Connection management (proxied to WebServer)
    # ------------------------------------------------------------------

    def connect(
        self,
        port: str,
        baudrate: int = 115200,
        timeout: int = 2,
    ) -> dict:
        """Connect to device via WebServer."""
        return self._post(
            "/api/connect",
            {"port": port, "baudrate": baudrate, "timeout": timeout},
        )

    def disconnect(self) -> dict:
        """Disconnect device via WebServer."""
        return self._post("/api/disconnect")

    # ------------------------------------------------------------------
    # Serial terminal (proxied to WebServer logs routes)
    # ------------------------------------------------------------------

    def serial_send(self, data: str) -> dict:
        """Send raw data to device serial port via WebServer.

        Uses the /api/serial/send endpoint (same as the web terminal).
        """
        return self._post("/api/serial/send", {"data": data})

    def serial_read(self, raw_since: int = 0) -> dict:
        """Read raw serial output via WebServer.

        Uses the /api/logs endpoint to fetch raw_serial_log entries.
        Returns dict with 'raw_data' and 'raw_next' for incremental reads.
        """
        return self._get(f"/api/logs?raw_since={raw_since}&tool_since=999999999")

    # ------------------------------------------------------------------
    # Device operations (proxied to WebServer)
    # ------------------------------------------------------------------

    def info(self) -> dict:
        """Get device FPB info via WebServer."""
        return self._get("/api/fpb/info")

    def inject(
        self,
        target_func: str,
        source_file: str,
        elf_path: Optional[str] = None,
        compile_commands: Optional[str] = None,
        patch_mode: str = "trampoline",
        comp: int = -1,
    ) -> dict:
        """Inject a patch via WebServer."""
        source_content = ""
        source_ext = ".c"
        if os.path.exists(source_file):
            with open(source_file, "r", encoding="utf-8") as f:
                source_content = f.read()
            source_ext = os.path.splitext(source_file)[1]

        payload: Dict[str, Any] = {
            "target_func": target_func,
            "source_content": source_content,
            "patch_mode": patch_mode,
            "comp": comp,
            "source_ext": source_ext,
            "original_source_file": os.path.abspath(source_file),
        }
        if elf_path:
            payload["elf_path"] = elf_path
        if compile_commands:
            payload["compile_commands_path"] = compile_commands

        return self._post("/api/fpb/inject", payload)

    def unpatch(self, comp: int = 0, all_patches: bool = False) -> dict:
        """Remove a patch via WebServer."""
        return self._post("/api/fpb/unpatch", {"comp": comp, "all": all_patches})

    def mem_read(self, addr: int, length: int, fmt: str = "hex") -> dict:
        """Read device memory via WebServer."""
        return self._post(
            "/api/fpb/mem-read",
            {"addr": addr, "length": length, "fmt": fmt},
        )

    def mem_write(self, addr: int, data_hex: str) -> dict:
        """Write device memory via WebServer."""
        return self._post(
            "/api/fpb/mem-write",
            {"addr": addr, "data": data_hex},
        )

    def test_serial(
        self, start_size: int = 16, max_size: int = 4096, timeout: float = 2.0
    ) -> dict:
        """Test serial throughput via WebServer."""
        return self._post(
            "/api/fpb/test-serial",
            {"start_size": start_size, "max_size": max_size, "timeout": timeout},
        )

    def file_list(self, path: str = "/") -> dict:
        """List directory contents via WebServer."""
        return self._get(f"/api/transfer/list?path={path}")

    def file_stat(self, path: str) -> dict:
        """Get file stat via WebServer."""
        return self._get(f"/api/transfer/stat?path={path}")

    def file_download(self, remote_path: str) -> dict:
        """Download file via WebServer (JSON with base64 data, no SSE)."""
        return self._post(
            "/api/transfer/download-sync",
            {"remote_path": remote_path},
        )
