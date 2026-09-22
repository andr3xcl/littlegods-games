from dataclasses import dataclass
from pathlib import Path
import threading
import time
from collections.abc import Callable


@dataclass
class CommandResult:
    code: int
    output: str


def add_torrent(
    torrent_path: str,
    save_path: str,
    on_output: Callable[[str], None] | None = None,
    cancel_event: threading.Event | None = None,
    control_path: str | None = None,
) -> CommandResult:
    try:
        import libtorrent as lt
    except ImportError:
        message = "Falta libtorrent. Instala libtorrent en el Python que usa Littlegods Games."
        if on_output:
            on_output(message)
        return CommandResult(1, message)

    torrent = Path(torrent_path)
    destination = Path(save_path)
    if not torrent.is_file() or torrent.suffix.lower() != ".torrent":
        message = "Selecciona un archivo .torrent valido."
        if on_output:
            on_output(message)
        return CommandResult(1, message)
    destination.mkdir(parents=True, exist_ok=True)

    try:
        settings = {"listen_interfaces": "0.0.0.0:6881-6891"}
        session = lt.session(settings)
        info = lt.torrent_info(str(torrent))
        handle = session.add_torrent({"ti": info, "save_path": str(destination)})
        handle.resume()
        control = Path(control_path) if control_path else None
        paused = False
        if on_output:
            on_output(f"Descarga iniciada sin limite en: {destination}")

        while not handle.status().is_seeding:
            should_pause = control is not None and control.exists()
            if should_pause and not paused:
                handle.pause()
                paused = True
                if on_output:
                    on_output("Descarga pausada.")
            elif not should_pause and paused:
                handle.resume()
                paused = False
                if on_output:
                    on_output("Descarga reanudada.")
            if cancel_event and cancel_event.is_set():
                session.remove_torrent(handle)
                message = "Descarga cancelada."
                if on_output:
                    on_output(message)
                return CommandResult(130, message)
            status = handle.status()
            progress = status.progress * 100
            speed = status.download_rate / 1024
            if on_output:
                on_output(
                    f"__PROGRESS__:{progress:.1f}:{speed:.0f}:"
                    f"{status.total_done}:{info.total_size()}:{status.num_peers}"
                )
            if cancel_event:
                cancel_event.wait(1)
            else:
                time.sleep(1)

        message = "Torrent completado correctamente."
        if on_output:
            on_output(message)
        return CommandResult(0, message)
    except Exception as error:
        message = f"No se pudo iniciar la descarga: {error}"
        if on_output:
            on_output(message)
        return CommandResult(1, message)
