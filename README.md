# Johnny B Home Construction — website preview

[Open the website](https://brockliddicoat.github.io/johnnybhome-preview/) ·
[Deployment status](https://github.com/brockliddicoat/johnnybhome-preview/actions/workflows/pages.yml)

The review preview of the new Johnny B Home Construction website. It includes the
public pages, live Google maps, and an admin demo with made-up sample requests.

**This is not the production website.** Forms do not send requests or upload
photos, and admin changes are not saved. The real website remains
[johnnybhome.com](https://johnnybhome.com).

## Repository layout

```text
src/
  pages/             Public pages, including home, contact, 404, and offline
  admin/             Admin-demo pages and sample request views
  assets/
    brand/           Logos and app icons
    css/             Public, admin, and preview styles
    fonts/           Local Montserrat font
    img/             Responsive website photographs
    js/              Navigation, forms, admin UI, and photo worker
  static/            Manifests, service worker, preview shim, icons, demo photos
tools/
  build.py           Assemble the deployable site into dist/
  verify.py          Check pages, links, assets, addresses, and preview protections
  import_preview.py  Import a fresh flat export into the organized source tree
  refresh/           Exporter, demo-data seeder, and sample photos from the handoff
docs/
  architecture.md       Source-to-URL mapping and deployment behavior
  refreshing-preview.md Regenerating the preview from the separate PHP application
.github/workflows/
  pages.yml          Validate changes and deploy main to GitHub Pages
```

`dist/` is generated and ignored by Git. Only its contents are published; tools,
documentation, and refresh helpers are not part of the hosted website.

## Local preview

Requires Python 3.10 or newer. No npm packages or PHP server are needed to build
and view this exported preview.

```sh
python tools/build.py
python tools/verify.py
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open <http://127.0.0.1:8000/>. After editing source, rebuild and reload the browser.

## Where to make changes

| Change | File or folder |
| --- | --- |
| Home page | `src/pages/index.html` |
| Contact, appointment, or service page | `src/pages/contact.html`, `appointment.html`, `service.html` |
| Public appearance | `src/assets/css/site.css` |
| Admin appearance | `src/assets/css/admin.css` |
| Menu and public interactions | `src/assets/js/site.js` |
| Form behavior | `src/assets/js/form.js` |
| Admin-demo screens | `src/admin/` |
| Preview-only submission blocking | `src/static/preview-shim.js` |
| App manifests and offline behavior | `src/static/` |
| Future exports and sample data | `tools/refresh/` |

The HTML is an export from a separate PHP application, not that application's
template source. Keep lasting changes in the PHP source when it becomes available,
or in the exporter when they are preview-specific. See the
[refresh guide](docs/refreshing-preview.md).

The office address is **825 S Huron Road, Suite G, Green Bay, Wisconsin 54311**,
and the **JBHC office phone number** is **+1 (920) 498-3299**. Response wording says
**“We’ll get back to you as soon as possible.”** The verifier catches outdated
contact details and response promises. Google's own map labels are controlled by Google.

## Deployment

Pushes to `main` build and validate the preview, then publish `dist/` through
GitHub Actions. Pull requests run the same checks without publishing.

The existing page URLs remain unchanged, including `contact.html`, `service.html`,
and `admin.html`. No custom domain is configured.

To compare a local build with the deployed site:

```sh
python tools/verify.py --url https://brockliddicoat.github.io/johnnybhome-preview/
```

See [architecture and deployment details](docs/architecture.md). On a phone, open
the website directly in Safari or Chrome to try Add to Home Screen.
