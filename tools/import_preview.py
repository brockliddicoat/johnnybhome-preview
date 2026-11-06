"""Import a validated flat preview export into the organized src/ tree."""
from datetime import datetime, timezone
from pathlib import Path
import argparse
import shutil
import tempfile

from verify import audit

ROOT = Path(__file__).resolve().parents[1]


def source_path(relative):
    if relative.parts[0] == "assets":
        return relative
    if len(relative.parts) == 1 and relative.suffix == ".html":
        return Path("admin" if relative.name.startswith("admin") else "pages") / relative
    return Path("static") / relative


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export_dir", type=Path)
    parser.add_argument("--check", action="store_true", help="Validate and describe the import without writing files")
    parser.add_argument("--replace", action="store_true", help="Replace src/ after saving a local backup")
    args = parser.parse_args()
    exported = args.export_dir.resolve()
    source = ROOT / "src"
    if source.is_symlink() or source.resolve() != ROOT / "src":
        parser.error("src/ must be a normal directory inside this checkout")
    if exported.is_relative_to(source) or source.is_relative_to(exported):
        parser.error("The export must not overlap src/ or include this repository")
    report = audit(exported)
    if report["failures"]:
        parser.error("Export validation failed:\n" + "\n".join(report["failures"]))
    files = sorted(p for p in exported.rglob("*") if p.is_file())
    print(f"Validated {len(files)} files and {report['html_pages']} HTML pages for import")
    if args.check:
        return
    if source.exists() and not args.replace:
        parser.error("src/ already exists; review changes, then use --replace to import with a backup")

    with tempfile.TemporaryDirectory(prefix=".preview-import-", dir=ROOT) as temporary:
        staged = Path(temporary) / "src"
        for group in ("pages", "admin", "assets", "static"):
            (staged / group).mkdir(parents=True, exist_ok=True)
        for file in files:
            target = staged / source_path(file.relative_to(exported))
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
        backup = None
        if source.exists():
            backup_root = ROOT / ".preview-backups"
            if backup_root.is_symlink() or backup_root.resolve() != ROOT / ".preview-backups":
                parser.error("Backup directory must stay inside this checkout")
            backup_root.mkdir(exist_ok=True)
            backup = backup_root / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            source.rename(backup)
        try:
            staged.rename(source)
        except Exception:
            if backup is not None:
                backup.rename(source)
            raise
        print(f"Imported into {source}")
        if backup is not None:
            print(f"Previous source preserved at {backup}")


if __name__ == "__main__":
    main()
