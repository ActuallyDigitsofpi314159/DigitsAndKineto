#!/usr/bin/env python3
"""Export the whole DASH Parkour soundtrack as WAV and/or MP3 files.

The music is synthesized in the browser, so this script serves the repository,
opens _sound-test/export.html in headless Chrome (which renders every song with
the game's own engine) and saves the files the page sends back.

    python3 _sound-test/export-music.py                       # WAV + MP3 -> ./ost-export
    python3 _sound-test/export-music.py --format mp3          # just MP3 (320 kbps)
    python3 _sound-test/export-music.py --format wav --out ~/Desktop/DASH-OST
    python3 _sound-test/export-music.py --start 12             # resume from track 12

Needs Python 3 and Google Chrome (or Chromium / Edge). MP3 encoding loads
lamejs from a CDN, so MP3 needs an internet connection; WAV does not.
Files are 44.1 kHz stereo, numbered in soundtrack order ("01 - Prologue.wav").
"""
import argparse
import http.server
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome():
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge"):
        path = shutil.which(name)
        if path:
            return path
    for path in CHROME_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def main():
    ap = argparse.ArgumentParser(description="Export the DASH Parkour soundtrack.")
    ap.add_argument("--format", choices=["both", "wav", "mp3"], default="both")
    ap.add_argument("--out", default=os.path.join(REPO, "ost-export"), help="output folder")
    ap.add_argument("--chrome", help="path to Chrome/Chromium if it is not found automatically")
    ap.add_argument("--start", type=int, default=1, help="track number to start from (to resume an export)")
    ap.add_argument("--show", action="store_true", help="show the browser window instead of running headless")
    args = ap.parse_args()

    chrome = args.chrome or find_chrome()
    if not chrome:
        sys.exit("Could not find Chrome. Pass its path with --chrome.")
    out = os.path.abspath(os.path.expanduser(args.out))
    os.makedirs(out, exist_ok=True)
    state = {"done": threading.Event(), "error": False, "saved": []}

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=REPO, **kw)

        def log_message(self, *a):
            pass

        def do_POST(self):
            url = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(url.query)
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            if url.path == "/__save":
                name = os.path.basename(q.get("name", ["track"])[0])  # never leave the output folder
                with open(os.path.join(out, name), "wb") as f:
                    f.write(body)
                state["saved"].append(name)
                print("  saved %s (%.1f MB)" % (name, len(body) / 1e6), flush=True)
            elif url.path == "/__log":
                print(body.decode("utf-8", "replace"), flush=True)
            elif url.path == "/__done":
                state["error"] = "error" in q
                state["done"].set()
            self.send_response(200)
            self.end_headers()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page = "http://127.0.0.1:%d/_sound-test/export.html?auto&format=%s&i=%d" % (server.server_port, args.format, max(0, args.start - 1))

    profile = tempfile.mkdtemp(prefix="dash-ost-chrome-")
    cmd = [chrome, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
           "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
           "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
           "--disable-features=IntensiveWakeUpThrottling"]
    if not args.show:
        cmd += ["--headless=new", "--mute-audio"]
    cmd.append(page)
    print("Rendering the soundtrack into %s (this takes a few minutes)..." % out, flush=True)
    start = time.time()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        while not state["done"].wait(1):
            if proc.poll() is not None:
                state["error"] = True
                print("Chrome closed before the export finished.")
                break
    except KeyboardInterrupt:
        state["error"] = True
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    print("%d files in %s (%.0f s)." % (len(state["saved"]), out, time.time() - start))
    sys.exit(1 if state["error"] else 0)


if __name__ == "__main__":
    main()
