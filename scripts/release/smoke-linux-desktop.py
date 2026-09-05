#!/usr/bin/env python3
"""Exercise an extracted Linux desktop in a private Xvfb/D-Bus session.

Requires distro Python GI/Gdk, python3-xlib, Xvfb, xauth and Tesseract English.
No source build, provider request, or host credentials are needed.
"""

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
RENDERED_TEXT = ("add your first project", "add a project", "start in a scratch workspace")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def rendered_ui(text):
    # OCR can join adjacent words ("Startin", "Adda"); require the letters of
    # each full phrase while tolerating whitespace and punctuation differences.
    normalized = "".join(re.findall(r"[a-z0-9]+", text.lower()))
    return all(phrase.replace(" ", "") in normalized for phrase in RENDERED_TEXT)


def inverted_grayscale(pixels, width, height, rowstride, channels):
    # PGM is readable by Tesseract; avoid an additional image-library dependency.
    gray = bytearray()
    for y in range(height):
        for x in range(width):
            offset = y * rowstride + x * channels
            red, green, blue = pixels[offset:offset + 3]
            gray.append(255 - (299 * red + 587 * green + 114 * blue) // 1000)
    return f"P5\n{width} {height}\n255\n".encode() + gray


def save_contrast_image(pixels, path):
    import gi
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import GdkPixbuf
    scaled = pixels.scale_simple(pixels.get_width() * 2, pixels.get_height() * 2,
                                 GdkPixbuf.InterpType.BILINEAR)
    path.write_bytes(inverted_grayscale(scaled.get_pixels(), scaled.get_width(), scaled.get_height(),
                                       scaled.get_rowstride(), scaled.get_n_channels()))


def recognize_frame(tesseract, screenshot, pixels, env):
    # Tesseract 4 can garble white text on the orange button. Try a contrast
    # variant of this same frame; each attempt must independently contain ALL
    # phrases. Never combine partial text across variants or captured frames.
    for variant in ("original", "contrast"):
        image_path = screenshot
        if variant == "contrast":
            image_path = screenshot.with_suffix(".contrast.pgm")
            save_contrast_image(pixels, image_path)
        ocr = subprocess.run([tesseract, str(image_path), "stdout", "-l", "eng", "--psm", "3"],
                             env=env, capture_output=True, text=True, timeout=10)
        require(ocr.returncode == 0, f"OCR failed: {ocr.stderr}")
        if rendered_ui(ocr.stdout):
            return ocr.stdout, variant
        if variant == "original":
            screenshot.with_suffix(".original.txt").write_text(ocr.stdout)
    return ocr.stdout, variant


def isolated_environment(state, inherited, display=False):
    env = {
        "HOME": str(state), "PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8",
        "LC_ALL": "C.UTF-8", "LANGUAGE": "en", "GDK_BACKEND": "x11",
        "LIBGL_ALWAYS_SOFTWARE": "1", "NODE_ENV": "production",
        "TMPDIR": str(state / "tmp"), "DATABASE_PATH": str(state / "auth.db"),
        "GJC_WORKER_AGENT_DIR": str(state / "agent"), "GJC_NO_TITLE": "1",
        "GAJAE_ALLOW_DEVELOPMENT_BUN": "0", "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0",
        "XDG_CONFIG_HOME": str(state / ".config"),
        "XDG_CACHE_HOME": str(state / ".cache"),
        "XDG_DATA_HOME": str(state / ".local/share"),
        "XDG_STATE_HOME": str(state / ".local/state"),
        "XDG_RUNTIME_DIR": str(state / "runtime"),
    }
    if display:
        for key in ("DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS"):
            if key in inherited:
                env[key] = inherited[key]
    return env


def validate_package(root, package_format):
    root = root.resolve(strict=True)
    require(not root.is_relative_to(ROOT), "Extract the package outside the checkout")
    for ancestor in (root, *root.parents):
        require(not (ancestor / "node_modules").exists(),
                f"Ancestor node_modules could mask missing bundled dependencies: {ancestor}")
    payloads = [p for pattern in ("usr/lib/*/resources/server-payload", "usr/lib/*/server-payload")
                for p in root.glob(pattern) if p.is_dir()]
    require(len(payloads) == 1, "Expected exactly one packaged server-payload")
    payload = payloads[0]
    require(payload.resolve().is_relative_to(root), "Payload escapes the extracted root")
    require(not os.path.lexists(payload / ".env"), "Refusing packaged .env (possible live credentials)")
    for directory, directories, files in os.walk(payload):
        for name in directories + files:
            candidate = Path(directory) / name
            if candidate.is_symlink():
                require(candidate.resolve(strict=True).is_relative_to(root),
                        f"Payload symlink escapes package: {candidate}")
    binary = root / ("AppRun" if package_format == "appimage" else "usr/bin/gajae-app-desktop")
    for candidate in (binary, root / "usr/bin/gajae-app-server"):
        require(candidate.resolve(strict=True).is_relative_to(root), f"Executable escapes package: {candidate}")
        require(os.access(candidate, os.X_OK), f"Not executable: {candidate}")
    return binary


def process_snapshot(proc=Path("/proc")):
    result = {}
    for directory in proc.glob("[0-9]*"):
        try:
            # comm may contain spaces and parentheses; fields after its last ')' are stable.
            fields = (directory / "stat").read_text().rsplit(")", 1)[1].split()
            result[int(directory.name)] = {
                "state": fields[0], "parent": int(fields[1]),
                "session": int(fields[3]), "start": int(fields[19]),
            }
        except (OSError, ValueError, IndexError):
            continue
    return result


def update_descendants(snapshot, tracked, root_pid, owner_pid):
    # A private session catches reparenting between polls. The subreaper adopts
    # orphaned grandchildren even when they created another process session.
    selected = {pid for pid, info in snapshot.items()
                if (pid == root_pid and (pid not in tracked or tracked[pid] == info["start"]))
                or (pid != root_pid and info["session"] == root_pid) or info["parent"] == owner_pid
                or tracked.get(pid) == info["start"]}
    while True:
        children = {pid for pid, info in snapshot.items() if info["parent"] in selected}
        if children <= selected:
            break
        selected |= children
    for pid in selected:
        tracked[pid] = snapshot[pid]["start"]


def remaining_processes(tracked):
    snapshot = process_snapshot()
    remaining = []
    for pid, start in tracked.items():
        info = snapshot.get(pid)
        if not info or info["start"] != start:
            continue
        if info["state"] == "Z" and info["parent"] == os.getpid():
            try:
                os.waitpid(pid, os.WNOHANG)
                continue
            except ChildProcessError:
                pass
        remaining.append(pid)
    return remaining


def listening_ports(pids):
    inodes = set()
    for pid in pids:
        for fd in Path(f"/proc/{pid}/fd").glob("*"):
            try:
                link = str(fd.readlink())
                if link.startswith("socket:["):
                    inodes.add(link[8:-1])
            except OSError:
                continue
    ports = set()
    for line in Path("/proc/net/tcp").read_text().splitlines()[1:]:
        fields = line.split()
        if fields[3] == "0A" and fields[9] in inodes:
            require(fields[1].startswith("0100007F:"), "App opened a non-loopback IPv4 listener")
            ports.add(int(fields[1].split(":")[1], 16))
    return ports


def port_closed(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return False
    except ConnectionRefusedError:
        return True


def check_health(port, expected_version):
    # No proxies, cookies, bootstrap tokens, or authenticated API calls.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f"http://127.0.0.1:{port}/health", timeout=1) as response:
            health = json.load(response)
        if isinstance(health, dict) and (health.get("status"), health.get("product"), health.get("protocolVersion"), health.get("version")) == (
                "ok", "gajae-app", 1, expected_version):
            return health
    except (OSError, ValueError):
        pass
    return None


def force_cleanup(process, tracked):
    # Only used after failure; a forced termination can never make the smoke pass.
    update_descendants(process_snapshot(), tracked, process.pid, os.getpid())
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid in remaining_processes(tracked):
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        deadline = time.monotonic() + 3
        while remaining_processes(tracked) and time.monotonic() < deadline:
            time.sleep(0.1)


def exercise(args, state):
    from Xlib import X, display, protocol
    import gi
    gi.require_version("Gdk", "3.0")
    gi.require_version("GdkX11", "3.0")
    from gi.repository import Gdk, GdkX11

    require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0,
            "Cannot enable Linux child subreaper")  # PR_SET_CHILD_SUBREAPER
    binary = validate_package(args.linux_root, args.format)
    expected_version = json.loads((ROOT / "package.json").read_text())["version"]
    env = isolated_environment(state, os.environ, display=True)
    connection = display.Display()
    gdk_display = Gdk.Display.get_default()
    require(gdk_display is not None, "No GDK display")
    report = {"format": args.format, "root": str(args.linux_root), "status": "failed",
              "expected_version": expected_version, "display_backend": "X11/Xvfb",
              "host": Path("/etc/os-release").read_text(),
              "glibc": os.confstr("CS_GNU_LIBC_VERSION"), "launches": []}
    def interrupted(signum, _frame):
        raise RuntimeError(f"GUI smoke interrupted by signal {signum}")

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGALRM, interrupted)
    signal.alarm(240)  # Fail through finally/cleanup before the outer watchdog.
    try:
        for attempt in (1, 2):
            entry = {"attempt": attempt, "status": "failed"}
            report["launches"].append(entry)
            tracked = {}
            screenshot = args.artifacts / f"launch-{attempt}.png"
            logfile = args.artifacts / f"launch-{attempt}.log"
            with logfile.open("w") as output:
                process = subprocess.Popen([str(binary)], cwd=state, env=env,
                                           stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    deadline = time.monotonic() + 60
                    healthy = None
                    window = None
                    consecutive_renders = 0
                    next_capture = 0
                    while time.monotonic() < deadline:
                        require(process.poll() is None, f"Desktop exited early: {process.returncode}; see {logfile}")
                        snapshot = process_snapshot()
                        update_descendants(snapshot, tracked, process.pid, os.getpid())
                        live_pids = {pid for pid, start in tracked.items() if snapshot.get(pid, {}).get("start") == start}
                        healthy = None
                        for port in listening_ports(live_pids):
                            healthy = check_health(port, expected_version)
                            if healthy:
                                entry.update(health=healthy, port=port)
                                break
                        for candidate in connection.screen().root.query_tree().children:
                            try:
                                pid_property = candidate.get_full_property(connection.intern_atom("_NET_WM_PID"), X.AnyPropertyType)
                                if (pid_property is not None and int(pid_property.value[0]) in live_pids
                                        and candidate.get_wm_name() == "Gajae Code App"
                                        and candidate.get_attributes().map_state == X.IsViewable):
                                    window = candidate
                                    break
                            except Exception:
                                continue  # A window can disappear while X11 is queried.
                        if window and healthy and time.monotonic() >= next_capture:
                            geometry = window.get_geometry()
                            require(geometry.width >= 960 and geometry.height >= 640, "App window is unexpectedly small")
                            gdk_window = GdkX11.X11Window.foreign_new_for_display(gdk_display, window.id)
                            pixels = Gdk.pixbuf_get_from_window(gdk_window, 0, 0, geometry.width, geometry.height)
                            require(pixels is not None, "Could not capture app window")
                            pixels.savev(str(screenshot), "png", [], [])
                            text, variant = recognize_frame(args.tesseract, screenshot, pixels, env)
                            (args.artifacts / f"launch-{attempt}.txt").write_text(text)
                            entry["ocr_variant"] = variant
                            consecutive_renders = consecutive_renders + 1 if rendered_ui(text) else 0
                            if consecutive_renders >= 2:
                                break
                            next_capture = time.monotonic() + 1
                        time.sleep(0.2)
                    require(window is not None and healthy and consecutive_renders >= 2,
                            f"Desktop did not persistently render the empty-workspace UI; see {args.artifacts}")
                    entry.update(screenshot=screenshot.name, screenshot_sha256=hashlib.sha256(screenshot.read_bytes()).hexdigest(),
                                 rendered_phrases=list(RENDERED_TEXT), consecutive_renders=consecutive_renders)
                    update_descendants(process_snapshot(), tracked, process.pid, os.getpid())
                    require(len(tracked) > 1, "No desktop child processes observed")
                    window.send_event(protocol.event.ClientMessage(window=window.id,
                        client_type=connection.intern_atom("WM_PROTOCOLS"),
                        data=(32, [connection.intern_atom("WM_DELETE_WINDOW"), X.CurrentTime, 0, 0, 0])), event_mask=0)
                    connection.flush()
                    deadline = time.monotonic() + 40
                    while process.poll() is None and time.monotonic() < deadline:
                        update_descendants(process_snapshot(), tracked, process.pid, os.getpid())
                        time.sleep(0.1)
                    require(process.poll() == 0, f"Window close did not exit cleanly: {process.returncode}")
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline:
                        update_descendants(process_snapshot(), tracked, process.pid, os.getpid())
                        if not remaining_processes(tracked):
                            break
                        time.sleep(0.1)
                    require(not remaining_processes(tracked), f"Descendants survived close: {remaining_processes(tracked)}")
                    require(port_closed(entry["port"]), "Sidecar port survived window close")
                    entry.update(status="passed", close_exit=0, descendants_exited=sorted(tracked), port_closed=True)
                    print(json.dumps(entry), flush=True)
                finally:
                    if entry["status"] != "passed":
                        force_cleanup(process, tracked)
        report["status"] = "passed"
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        signal.alarm(0)
        connection.close()
        (args.artifacts / "report.json").write_text(json.dumps(report, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--linux-root", type=Path, required=True)
    parser.add_argument("--format", choices=("deb", "appimage"), required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--inside", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--tesseract", help=argparse.SUPPRESS)
    args = parser.parse_args()
    args.linux_root = args.linux_root.resolve(strict=True)
    args.artifacts = args.artifacts.resolve()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    if args.inside:
        exercise(args, args.inside)
        return 0
    require(not any(args.artifacts.iterdir()), "Use an empty artifacts directory to avoid stale pass reports")
    require(sys.platform == "linux", "This harness requires Linux")
    validate_package(args.linux_root, args.format)
    programs = {name: shutil.which(name) for name in ("xvfb-run", "xauth", "dbus-run-session", "tesseract")}
    require(all(programs.values()), f"Missing GUI prerequisites: {[key for key, value in programs.items() if not value]}")
    with tempfile.TemporaryDirectory(prefix="gajae-desktop-gui-", dir="/tmp") as directory:
        state = Path(directory)
        for relative in ("tmp", "agent", ".config", ".cache", ".local/share", ".local/state", "runtime"):
            (state / relative).mkdir(parents=True, mode=0o700)
        env = isolated_environment(state, {})
        # Optional local Xlib installation applies only to the test interpreter;
        # it is never passed to the app or its subprocesses.
        if "PYTHONPATH" in os.environ:
            env["PYTHONPATH"] = os.pathsep.join(str(Path(p).resolve()) for p in os.environ["PYTHONPATH"].split(os.pathsep) if p)
        command = [programs["xvfb-run"], "-a", "-s", "-screen 0 1280x900x24 -nolisten tcp",
                   programs["dbus-run-session"], "--", sys.executable, str(Path(__file__).resolve()),
                   "--linux-root", str(args.linux_root), "--format", args.format,
                   "--artifacts", str(args.artifacts), "--inside", str(state), "--tesseract", programs["tesseract"]]
        with (args.artifacts / "session.log").open("w") as output:
            result = subprocess.run(command, cwd=state, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=260)
        print(f"{'PASS' if result.returncode == 0 else 'FAIL'}: {args.format} desktop GUI; evidence: {args.artifacts}")
        return result.returncode


def self_test():
    import io
    import unittest
    from unittest.mock import patch

    class SmokeTests(unittest.TestCase):
        def test_contrast_conversion_handles_alpha_and_row_padding(self):
            # Two RGBA pixels on padded rows: white -> black; black -> white.
            pixels = bytes([255, 255, 255, 0, 99, 99, 99, 99, 0, 0, 0, 255, 88, 88, 88, 88])
            self.assertEqual(inverted_grayscale(pixels, 1, 2, 8, 4), b"P5\n1 2\n255\n\x00\xff")
            self.assertEqual(inverted_grayscale(bytes([255, 0, 0]), 1, 1, 3, 3), b"P5\n1 1\n255\n\xb3")

        def test_ocr_fallback_requires_all_phrases_in_one_variant(self):
            # Tesseract 4.1.1's Jammy fixture: only the colored button is garbled.
            original = "Add your first project\new CE tad\nStartin a scratch workspace"
            complete = "Add your first project\nAdd a project\nStartina scratch workspace"
            with tempfile.TemporaryDirectory() as directory:
                screenshot = Path(directory) / "frame.png"
                def result(text):
                    return subprocess.CompletedProcess([], 0, stdout=text, stderr="")
                for fallback, accepted in ((complete, True), ("Add a project", False), ("Add a projeet", False)):
                    with patch("subprocess.run", side_effect=[result(original), result(fallback)]), \
                            patch.dict(globals(), save_contrast_image=lambda _pixels, _path: None):
                        text, variant = recognize_frame("tesseract", screenshot, None, {})
                        self.assertEqual(rendered_ui(text), accepted)
                        self.assertEqual(variant, "contrast")
                        self.assertEqual(screenshot.with_suffix(".original.txt").read_text(), original)
                with patch("subprocess.run", return_value=result(complete)) as run, \
                        patch.dict(globals(), save_contrast_image=lambda *_args: self.fail("Unnecessary fallback")):
                    text, variant = recognize_frame("tesseract", screenshot, None, {})
                    self.assertTrue(rendered_ui(text))
                    self.assertEqual(variant, "original")
                    self.assertEqual(run.call_count, 1)

        def test_render_requires_content_beyond_title_or_nonblank_window(self):
            for text in ("", "Gajae Code App", "Gajae Code App could not start Retry",
                         "Starting gajae-app", "Add your first project Add a project"):
                self.assertFalse(rendered_ui(text))
            self.assertTrue(rendered_ui("ADD your first project\nAdd a project\nStart in a scratch workspace"))
            self.assertTrue(rendered_ui("Add your first project\nAdda project\nStartin a scratch workspace"))

        def test_application_environment_excludes_host_credentials_and_sessions(self):
            inherited = {key: "host-value" for key in (
                "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "NODE_OPTIONS", "NODE_PATH",
                "LD_PRELOAD", "PYTHONPATH", "HOME", "DATABASE_PATH", "GJC_WORKER_AGENT_DIR",
                "XDG_RUNTIME_DIR", "HTTP_PROXY", "DBUS_SESSION_BUS_ADDRESS", "DISPLAY")}
            state = Path("/isolated")
            env = isolated_environment(state, inherited)
            self.assertNotIn("host-value", env.values())
            env = isolated_environment(state, inherited, display=True)
            self.assertEqual({key for key, value in env.items() if value == "host-value"},
                             {"DISPLAY", "DBUS_SESSION_BUS_ADDRESS"})
            self.assertEqual(env["HOME"], "/isolated")
            self.assertEqual(env["DATABASE_PATH"], "/isolated/auth.db")
            self.assertEqual(env["XDG_RUNTIME_DIR"], "/isolated/runtime")

        def test_tracks_grandchildren_and_reparented_processes(self):
            def info(parent, session, start=1):
                return {"parent": parent, "session": session, "start": start, "state": "S"}
            tracked = {}
            snapshot = {10: info(1, 10), 11: info(10, 10), 12: info(11, 12),
                        13: info(1, 10), 14: info(99, 14), 15: info(1, 15)}
            update_descendants(snapshot, tracked, 10, 99)
            self.assertEqual(set(tracked), {10, 11, 12, 13, 14})
            # An orphan retains its identity; a recycled PID is not our child.
            with patch.dict(snapshot, {12: info(1, 12), 11: info(1, 11, start=2)}):
                with patch.dict(globals(), process_snapshot=lambda: snapshot):
                    self.assertIn(12, remaining_processes(tracked))
                    self.assertNotIn(11, remaining_processes(tracked))
            update_descendants({10: info(1, 10, start=2)}, tracked, 10, 99)
            self.assertEqual(tracked[10], 1)

        def test_proc_parser_handles_spaces_and_parentheses(self):
            with tempfile.TemporaryDirectory() as directory:
                proc = Path(directory)
                (proc / "123").mkdir()
                fields = ["S", "12", "123", "99"] + ["0"] * 15 + ["456"]
                (proc / "123/stat").write_text("123 (test (worker)) " + " ".join(fields))
                self.assertEqual(process_snapshot(proc)[123],
                                 {"state": "S", "parent": 12, "session": 99, "start": 456})

        def test_package_rejects_dotenv_and_escaping_launchers(self):
            with tempfile.TemporaryDirectory(dir="/tmp") as directory:
                root = Path(directory)
                payload = root / "usr/lib/test/resources/server-payload"
                payload.mkdir(parents=True)
                (root / "usr/bin").mkdir()
                for name in ("gajae-app-desktop", "gajae-app-server"):
                    binary = root / "usr/bin" / name
                    binary.write_text("fixture")
                    binary.chmod(0o700)
                validate_package(root, "deb")
                (payload / ".env").symlink_to(root / "missing-credentials")
                with self.assertRaisesRegex(RuntimeError, "Refusing packaged .env"):
                    validate_package(root, "deb")
                (payload / ".env").unlink()
                (payload / "host-config").symlink_to("/etc")
                with self.assertRaisesRegex(RuntimeError, "Payload symlink escapes"):
                    validate_package(root, "deb")
                (payload / "host-config").unlink()
                (root / "AppRun").symlink_to("/bin/sh")
                with self.assertRaisesRegex(RuntimeError, "Executable escapes"):
                    validate_package(root, "appimage")

        def test_port_requires_connection_refusal_not_any_http_error(self):
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                listener.listen()
                port = listener.getsockname()[1]
                self.assertFalse(port_closed(port))
            self.assertTrue(port_closed(port))
            with patch("socket.create_connection", side_effect=TimeoutError):
                with self.assertRaises(TimeoutError):
                    port_closed(port)

        def test_health_rejects_wrong_identity_and_malformed_payload(self):
            good = {"status": "ok", "product": "gajae-app", "protocolVersion": 1, "version": "test-version"}
            responses = [good, [], {**good, "product": "other"}, {**good, "version": "stale"},
                         {**good, "protocolVersion": 2}, {**good, "status": "starting"}]
            for index, response in enumerate(responses):
                with patch("urllib.request.build_opener") as factory:
                    factory.return_value.open.return_value = io.BytesIO(json.dumps(response).encode())
                    self.assertEqual(bool(check_health(12345, "test-version")), index == 0)

        def test_failure_cleanup_removes_real_child_and_grandchild(self):
            libc = ctypes.CDLL(None)
            self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
            leaf = "import time; time.sleep(30)"
            child = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{leaf!r}]); time.sleep(30)"
            parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{child!r}]); time.sleep(30)"
            process = subprocess.Popen([sys.executable, "-c", parent], start_new_session=True)
            tracked = {}
            try:
                deadline = time.monotonic() + 5
                while len(tracked) < 3 and time.monotonic() < deadline:
                    update_descendants(process_snapshot(), tracked, process.pid, os.getpid())
                    time.sleep(0.05)
                self.assertEqual(len(tracked), 3)
                force_cleanup(process, tracked)
                self.assertFalse(remaining_processes(tracked))
                self.assertNotEqual(process.returncode, 0)
            finally:
                force_cleanup(process, tracked)
                libc.prctl(36, 0, 0, 0, 0)

    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SmokeTests))
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else main())
