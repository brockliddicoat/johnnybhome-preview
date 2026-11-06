# Refreshing the exported preview

Ordinary source edits only need `python tools/build.py`. A full regeneration also
requires the separate `JBHC-website.zip` PHP application from the original handoff.
That application is not included in this repository.

## Requirements

- Python 3.10 or newer; the repository tools use only the standard library.
- PHP 8.1 or newer with `pdo_sqlite` and `gd`, only for regenerating the export.
- A local copy of the PHP website and a separate, throwaway demo copy with an empty
  `data/` directory. Keep both outside this public repository.

Do not use a production data directory. The seeder rejects copies containing
request email addresses outside `example.com`, but use a fresh demo copy regardless.

## Generate a fresh flat export

The following examples assume the application copies are `../johnnybhome` and
`../demo`, relative to the repository root.

1. Populate only the throwaway copy with fictional requests:

   ```sh
   php tools/refresh/demo_seed.php ../demo tools/refresh/demo-photos
   php ../demo/app/cli.php password preview-demo-only
   ```

   `preview-demo-only` is a disposable local-demo password, never a production one.

2. Run the two local PHP servers in separate terminals:

   ```sh
   php -S 127.0.0.1:8080 -t ../johnnybhome/public ../johnnybhome/public/index.php
   php -S 127.0.0.1:8090 -t ../demo/public ../demo/public/index.php
   ```

3. Export into a disposable, ignored directory. In PowerShell:

   ```powershell
   $env:DEMO_ADMIN_PASSWORD = 'preview-demo-only'
   python -I tools/refresh/export_github_preview.py http://127.0.0.1:8080 ../johnnybhome .scratch/preview-export --admin=http://127.0.0.1:8090
   Remove-Item Env:DEMO_ADMIN_PASSWORD
   ```

   In bash, prefix the same Python command with
   `DEMO_ADMIN_PASSWORD=preview-demo-only` instead. The exporter replaces its output
   directory, so always use the disposable `.scratch/preview-export` destination.

   Do not pass `--artifact` for GitHub Pages. That mode is for hosts that cannot
   show live embeds or run the service worker.

## Import, review, and deploy

```sh
python tools/import_preview.py .scratch/preview-export --check
python tools/import_preview.py .scratch/preview-export --replace
python tools/build.py
python tools/verify.py
git diff --stat
```

The importer validates the flat export before writing anything, sorts it into the
four `src/` groups, and preserves the previous source under the ignored
`.preview-backups/` directory. It replaces the generated source as a unit so old
export files do not linger. It does not touch documentation, tools, or workflows.

Review the actual changes, commit the intended source updates, and push to `main`.
GitHub Actions validates and deploys the new build. After deployment:

```sh
python tools/verify.py --url https://brockliddicoat.github.io/johnnybhome-preview/
```

Check the pages in a browser as well, especially navigation, Google Maps, and the
preview notices on forms/admin controls.

## Changes retained from the migration

- The exporter spells out the office and sample-request street addresses, directions,
  and Wisconsin state name. The demo seed uses the expanded addresses too.
- Every exported page, including the offline page, receives a preview banner.
- `noindex, nofollow`, the preview shim, relative asset paths, app manifests, and the
  live Google map embeds remain part of the GitHub export.

These are preview/export changes. Apply the same address wording to the production
PHP templates separately when those sources become available. Never point
`johnnybhome.com` at this review preview or add a `CNAME` file.
