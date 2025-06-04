import asyncio
import base64
import datetime
import glob
import json
import os
import ssl

import aiohttp
import certifi

import decky  # type: ignore
from settings import SettingsManager  # type: ignore


class Plugin:
    yt_process: asyncio.subprocess.Process | None = None
    # We need this lock to make sure the process output isn't read by two concurrent readers at once.
    yt_process_lock = asyncio.Lock()
    # Open file handle receiving the current yt-dlp process' stderr.
    yt_stderr_file = None
    music_path = f"{decky.DECKY_PLUGIN_RUNTIME_DIR}/music"
    cache_path = f"{decky.DECKY_PLUGIN_RUNTIME_DIR}/cache"
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    async def _main(self):
        self.settings = SettingsManager(
            name="config", settings_directory=decky.DECKY_PLUGIN_SETTINGS_DIR
        )

    async def _unload(self):
        # Add a check to make sure the process is still running before trying to terminate to avoid ProcessLookupError
        if self.yt_process is not None and self.yt_process.returncode is None:
            self.yt_process.terminate()
            # Wait for process to terminate.
            async with self.yt_process_lock:
                try:
                    # Allow up to 5 seconds for termination.
                    await asyncio.wait_for(self.yt_process.communicate(), timeout=5)
                except TimeoutError:
                    # Otherwise, send SIGKILL.
                    self.yt_process.kill()
        if self.yt_stderr_file is not None:
            self.yt_stderr_file.close()
            self.yt_stderr_file = None

    @staticmethod
    def _subprocess_env():
        # Decky's plugin_loader is a PyInstaller-frozen binary that exports
        # LD_LIBRARY_PATH pointing at its bundled (older) libs in /tmp/_MEI*.
        # Child processes like yt-dlp then load that stale libcrypto.so.3
        # instead of the system one, which breaks the system Python's _ssl
        # module (OPENSSL_3.3.0 not found) and makes yt-dlp exit immediately.
        # PyInstaller stashes the original value in LD_LIBRARY_PATH_ORIG, so
        # restore it (or drop the var entirely) for our children.
        env = dict(os.environ)
        lp_orig = env.get("LD_LIBRARY_PATH_ORIG")
        if lp_orig is not None:
            env["LD_LIBRARY_PATH"] = lp_orig
        else:
            env.pop("LD_LIBRARY_PATH", None)
        return env

    async def set_setting(self, key, value):
        self.settings.setSetting(key, value)

    async def get_setting(self, key, default):
        return self.settings.getSetting(key, default)

    async def search_yt(self, term: str):
        decky.logger.info("search_yt: term=%r", term)
        # Add a check to make sure the process is still running before trying to terminate to avoid ProcessLookupError
        if self.yt_process is not None and self.yt_process.returncode is None:
            self.yt_process.terminate()
            # Wait for process to terminate.
            async with self.yt_process_lock:
                await self.yt_process.communicate()
        yt_dlp_path = f"{decky.DECKY_PLUGIN_DIR}/bin/yt-dlp"
        # Capture yt-dlp's stderr to a file so failures inside the plugin's
        # (systemd) environment are inspectable. Writing to a file avoids any
        # risk of a stderr pipe filling up and deadlocking yt-dlp. Close any
        # handle left over from a previous search to avoid leaking fds.
        if self.yt_stderr_file is not None:
            self.yt_stderr_file.close()
        stderr_path = f"{decky.DECKY_PLUGIN_RUNTIME_DIR}/yt-dlp-stderr.log"
        self.yt_stderr_file = open(stderr_path, "w")
        self.yt_process = await asyncio.create_subprocess_exec(
            yt_dlp_path,
            f"ytsearch10:{term}",
            "-j",
            "-f",
            "bestaudio",
            "--match-filters",
            f"duration<?{20*60}",  # 20 minutes is too long.
            stdout=asyncio.subprocess.PIPE,
            stderr=self.yt_stderr_file,
            env=self._subprocess_env(),
            # The returned JSON can get rather big, so we set a generous limit of 10 MB.
            limit=10 * 1024**2,
        )
        decky.logger.info(
            "search_yt: spawned %s (pid=%s), stderr -> %s",
            yt_dlp_path,
            self.yt_process.pid,
            stderr_path,
        )

    async def next_yt_result(self):
        async with self.yt_process_lock:
            if not self.yt_process or not (output := self.yt_process.stdout):
                decky.logger.info("next_yt_result: no active process/stdout")
                return None
            line = (await output.readline()).strip()
            if not line:
                decky.logger.info(
                    "next_yt_result: empty line / EOF (returncode=%s)",
                    self.yt_process.returncode,
                )
                return None
            try:
                entry = json.loads(line)
            except Exception:
                decky.logger.exception(
                    "next_yt_result: failed to parse line: %r", line[:300]
                )
                return None
            try:
                info = self.entry_to_info(entry)
            except Exception:
                decky.logger.exception("next_yt_result: entry_to_info failed")
                return None
            decky.logger.info(
                "next_yt_result: id=%s title=%r", info.get("id"), info.get("title")
            )
            return info

    @staticmethod
    def entry_to_info(entry):
        # Newer yt-dlp builds don't always expose every key at the top level
        # (e.g. "thumbnail" can be missing), so use .get() to avoid a KeyError
        # that would abort the whole search and leave the UI list empty.
        video_id = entry.get("id")
        return {
            "url": entry.get("url"),
            "title": entry.get("title") or video_id,
            "id": video_id,
            "thumbnail": entry.get("thumbnail")
            or (
                f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
                if video_id
                else ""
            ),
        }

    def local_match(self, id: str) -> str | None:
        local_matches = [
            x for x in glob.glob(f"{self.music_path}/{id}.*") if os.path.isfile(x)
        ]
        if len(local_matches) == 0:
            return None

        assert (
            len(local_matches) == 1
        ), "More than one downloaded audio with same ID found."
        return local_matches[0]

    async def single_yt_url(self, id: str):
        local_match = self.local_match(id)
        if local_match is not None:
            # The audio has already been downloaded, so we can just use that one.
            # However, we cannot use local paths in the <audio> elements, so we'll
            # convert this to a base64-encoded data URL first.
            extension = local_match.split(".")[-1]
            with open(local_match, "rb") as file:
                return f"data:audio/{extension};base64,{base64.b64encode(file.read()).decode()}"
        result = await asyncio.create_subprocess_exec(
            f"{decky.DECKY_PLUGIN_DIR}/bin/yt-dlp",
            f"{id}",
            "-j",
            "-f",
            "bestaudio",
            stdout=asyncio.subprocess.PIPE,
            env=self._subprocess_env(),
        )
        if (
            result.stdout is None
            or len(output := (await result.stdout.read()).strip()) == 0
        ):
            return None
        entry = json.loads(output)
        return entry["url"]

    async def download_yt_audio(self, id: str):
        if self.local_match(id) is not None:
            # Already downloaded—there's nothing we need to do.
            return
        process = await asyncio.create_subprocess_exec(
            f"{decky.DECKY_PLUGIN_DIR}/bin/yt-dlp",
            f"{id}",
            "-f",
            "bestaudio",
            "-o",
            "%(id)s.%(ext)s",
            "-P",
            self.music_path,
            env=self._subprocess_env(),
        )
        await process.communicate()

    async def download_url(self, url: str, id: str):
        async with aiohttp.ClientSession() as session:
            res = await session.get(url, ssl=self.ssl_context)
            res.raise_for_status()
            with open(f"{self.music_path}/{id}.webm", "wb") as file:
                async for chunk in res.content.iter_chunked(1024):
                    file.write(chunk)

    async def clear_downloads(self):
        for file in glob.glob(f"{self.music_path}/*"):
            if os.path.isfile(file):
                os.remove(file)

    async def export_cache(self, cache: dict):
        os.makedirs(self.cache_path, exist_ok=True)
        filename = f"backup-{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}.json"
        with open(f"{self.cache_path}/{filename}", "w") as file:
            json.dump(cache, file)

    async def list_cache_backups(self):
        return [
            file.split("/")[-1].rsplit(".", 1)[0]
            for file in glob.glob(f"{self.cache_path}/*")
        ]

    async def import_cache(self, name: str):
        with open(f"{self.cache_path}/{name}.json", "r") as file:
            return json.load(file)

    async def clear_cache(self):
        for file in glob.glob(f"{self.cache_path}/*"):
            if os.path.isfile(file):
                os.remove(file)
