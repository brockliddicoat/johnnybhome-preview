# Source organization and deployment

## Source folders do not change public URLs

This repository separates files by responsibility while preserving the relative
URLs produced by the original exporter. The build copies bytes; it does not rewrite,
minify, reformat, or bundle the website.

| Source | Build output / public path |
| --- | --- |
| `src/pages/index.html` | `dist/index.html` / `/johnnybhome-preview/` |
| `src/pages/contact.html` | `dist/contact.html` / `/johnnybhome-preview/contact.html` |
| `src/admin/admin.html` | `dist/admin.html` / `/johnnybhome-preview/admin.html` |
| `src/admin/admin-request-1.html` | `dist/admin-request-1.html` |
| `src/assets/**` | `dist/assets/**` |
| `src/static/**` | `dist/**`, preserving paths below `static/` |

The `README.md` in `src/static/` is the original short, public preview note. The
repository-root README is the development guide; it is not published to the site.

## Build and checks

`tools/build.py` collects the four source groups into `dist/`. It refuses duplicate
output paths or source symlinks and only replaces this checkout's generated
`dist/` directory. It never edits source files.

`tools/verify.py` checks:

- relative navigation and asset paths, including CSS URLs and responsive images;
- manifests, icons, start URLs, and project-scoped app installation;
- preview banners, `noindex, nofollow`, the submission-blocking shim, and admin-demo labels;
- the corrected office address (including Suite G), current business phone, response
  wording, expanded sample-address spelling, and the four live Google map embeds;
- exclusion of PHP, databases, environment files, Git metadata, and maintenance directories.

Optional `--url` verification downloads each public file and compares its SHA-256
with the local build. Optional `--report path.json` saves the result. The verifier
checks the exported artifact; it does not prove a physical-phone installation or
all browser interactions.

## GitHub Pages

The Pages publishing source is **GitHub Actions**, not a branch folder. The
workflow in `.github/workflows/pages.yml`:

1. checks out source and prepares Python;
2. builds `dist/`, validates it, and checks JavaScript syntax;
3. uploads only `dist/`, including `.nojekyll`;
4. deploys that artifact after the build succeeds.

Pull requests stop after validation. The deployment job uses the existing
`github-pages` environment and the minimum Pages/OIDC permissions required by
[GitHub's custom-workflow deployment](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The website stays at <https://brockliddicoat.github.io/johnnybhome-preview/>. The
production domain and hosting are not part of this repository's deployment.

## Preview boundaries

`preview-shim.js` supplies preview-only responses for form submissions and photo
uploads and stops admin writes. The sample admin data is fictional. Search-engine
exclusion is a request to crawlers, not access control: the preview and repository
are public.

`tools/refresh/demo_seed.php` is a helper for a throwaway local demo copy, not the
production application. The actual PHP application, its private data, and its
configuration are not included here and must not be imported into `src/`.
