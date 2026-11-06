"""Build the static preview without changing its public URLs or file contents."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src"
OUTPUT = ROOT / "dist"
GROUPS = {"pages": Path(), "admin": Path(), "assets": Path("assets"), "static": Path()}


def build():
    files = {}
    for group, target in GROUPS.items():
        directory = SOURCE / group
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError(f"Missing or linked source directory: {directory}")
        for source in sorted(directory.rglob("*")):
            if source.is_symlink() or not source.resolve().is_relative_to(SOURCE.resolve()):
                raise ValueError(f"Source link escapes the build boundary: {source}")
            if not source.is_file():
                continue
            relative = source.relative_to(directory)
            if group in {"pages", "admin"} and (len(relative.parts) != 1 or source.suffix != ".html"):
                raise ValueError(f"Page groups may contain only top-level HTML files: {source}")
            destination = target / relative
            if destination in files:
                raise ValueError(f"Two source files produce the same URL: {destination}")
            files[destination] = source
    for required in ("index.html", "404.html", "offline.html", ".nojekyll", "preview-shim.js"):
        if Path(required) not in files:
            raise ValueError(f"Missing required deployment file: {required}")

    # Only this checkout's generated dist/ directory can be replaced.
    if OUTPUT.is_symlink() or OUTPUT.resolve() != ROOT / "dist":
        raise ValueError("Refusing to replace an output path outside this checkout")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir()
    for relative, source in files.items():
        destination = OUTPUT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    print(f"Built {len(files)} files into {OUTPUT}")


if __name__ == "__main__":
    build()
