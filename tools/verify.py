"""Validate the built preview; optionally verify the exact files served by Pages."""
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from urllib.request import Request, urlopen
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.tags = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


def audit(site):
    site = Path(site).resolve()
    failures = []

    def require(condition, message):
        if not condition:
            failures.append(message)

    def local_ref(source, url):
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or not parsed.path:
            return
        require(not parsed.path.startswith("/"), f"{source.name}: root-relative link {url}")
        target = (source.parent / unquote(parsed.path)).resolve()
        require(target.is_relative_to(site), f"{source.name}: link escapes site: {url}")
        require(target.is_file(), f"{source.name}: missing linked file {url}")

    require(site.is_dir(), f"Site directory does not exist: {site}; run tools/build.py first")
    files = sorted(p for p in site.rglob("*") if p.is_file())
    html_files = [p for p in files if p.suffix == ".html"]
    require((site / ".nojekyll").is_file(), "missing .nojekyll")
    require(not (site / "CNAME").exists(), "unexpected custom domain")
    for path in files:
        relative = path.relative_to(site)
        require(not path.is_symlink() and path.resolve().is_relative_to(site), f"unexpected linked file: {relative}")
        require(path.suffix.lower() not in {".php", ".sqlite", ".db", ".env"} and not path.name.startswith(".env"), f"unexpected server/private file: {relative}")
        require(not {"data", ".git", ".github", "tools", "docs"}.intersection(relative.parts), f"unexpected non-site directory: {relative}")
        if path.suffix == ".html":
            source = path.read_text(encoding="utf-8")
            page = Page(source)
            require(any(t == "meta" and a.get("name") == "robots" and a.get("content") == "noindex, nofollow" for t, a in page.tags), f"{path.name}: missing noindex")
            require(sum("preview-banner" in a.get("class", "").split() for _, a in page.tags) == 1, f"{path.name}: expected one preview banner")
            require(any(t == "script" and a.get("src") == "preview-shim.js" for t, a in page.tags), f"{path.name}: missing shim")
            require(not any(t == "script" and a.get("type") == "application/ld+json" for t, a in page.tags), f"{path.name}: structured business data")
            if path.name.startswith("admin"):
                require("Admin demo" in source, f"{path.name}: missing demo label")
            require(not re.search(r"\b(?:Rd|Dr|Ln|Ct|St|Ave|Blvd|Hwy|Pkwy|Cir|Trl)\.?\b", source), f"{path.name}: unexpanded street abbreviation")
            require("825 S Huron" not in source and "Green Bay, WI 54311" not in source, f"{path.name}: unexpanded address")
            for _, attrs in page.tags:
                for attr in ("src", "href", "action", "poster"):
                    if attrs.get(attr):
                        local_ref(path, attrs[attr])
                if attrs.get("srcset"):
                    for item in attrs["srcset"].split(","):
                        local_ref(path, item.strip().split()[0])
        elif path.suffix == ".css":
            for ref in re.findall(r"url\(['\"]?([^)'\"]+)", path.read_text(encoding="utf-8")):
                local_ref(path, ref)
        elif path.suffix == ".webmanifest":
            manifest = json.loads(path.read_text(encoding="utf-8"))
            require(manifest["scope"] == "./", f"{path.name}: scope escapes preview")
            local_ref(path, manifest["start_url"])
            for icon in manifest.get("icons", []):
                local_ref(path, icon["src"])
            for entry in manifest.get("shortcuts", []):
                local_ref(path, entry["url"])
                for icon in entry.get("icons", []):
                    local_ref(path, icon["src"])

    for name in ("index.html", "contact.html", "appointment.html", "service.html"):
        if not (site / name).is_file():
            require(False, f"Missing required page: {name}")
            continue
        page = Page((site / name).read_text(encoding="utf-8"))
        require(any(t == "iframe" and a.get("src", "").startswith("https://www.google.com/maps/embed?") for t, a in page.tags), f"{name}: missing live Google map")
    return {"files": len(files), "html_pages": len(html_files), "failures": failures}


def verify_remote(site, base):
    base = base.rstrip("/") + "/"

    def check(path):
        relative = path.relative_to(site).as_posix()
        request = Request(base + quote(relative), headers={"User-Agent": "JBHC-preview-verification", "Cache-Control": "no-cache"})
        try:
            with urlopen(request, timeout=30) as response:
                return {"path": relative, "status": response.status, "sha256_matches": hashlib.sha256(response.read()).digest() == hashlib.sha256(path.read_bytes()).digest()}
        except Exception as error:
            return {"path": relative, "error": str(error)}

    # .nojekyll is a publication control file, not a served asset.
    files = sorted(p for p in site.rglob("*") if p.is_file() and not p.name.startswith("."))
    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(check, files))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--url", help="Also compare every public file with this deployed base URL")
    parser.add_argument("--report", type=Path, help="Optional JSON verification report")
    args = parser.parse_args()
    site = args.site_dir.resolve()
    report = audit(site)
    if args.url and not report["failures"]:
        report["remote"] = verify_remote(site, args.url)
        for entry in report["remote"]:
            if entry.get("status") != 200 or not entry.get("sha256_matches"):
                report["failures"].append(f"remote mismatch: {entry}")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "remote"}, indent=2))
    if "remote" in report:
        print(f"Compared {len(report['remote'])} public files with the local build.")
    return bool(report["failures"])


if __name__ == "__main__":
    raise SystemExit(main())
