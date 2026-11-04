# Midea ProShop & HVAC Solution — Coverage Dashboard

Published with GitHub Pages: **https://innovations-project.github.io/midea-coverage/**

Everything is served from the repository root, so a push to `main` is all it takes
to update the live site — `.github/workflows/pages.yml` uploads the root folder and
deploys it.

| Path | What it is |
| --- | --- |
| `index.html` | the dashboard page |
| `assets/css/styles.css` | all styling |
| `assets/js/config.js` | settings: sign-in, page sizes |
| `assets/js/app.js` | all logic |
| `data/dataset.js` | the workbook data (1,924 records) |
| `data/ph-map.js` | generated province outlines (81 provinces) |
| `tools/` | helper scripts (map + single-file build, local server) |

## Sign-in

The site asks for a Supabase account when it is served over http/https from a real
host, and opens straight away when the page is opened from disk (`file://`) or from
localhost. That behaviour lives in `assets/js/config.js`; set `auth.required` to a
plain `true` or `false` if you'd rather not have it decided for you.

Only the publishable ("anon") key is in that file. It is public by design — never
put a service-role key in the repo. Note that `data/dataset.js` is public too: the
gate hides the interface, it does not protect the data file.

## Updating the numbers

Open the live site, use **Import workbook**, then **Report → Download dataset.js**
(or **Export master data**) and commit the new file as `data/dataset.js`.

## Rebuilding the map or the single-file version

```bash
perl tools/build-map.pl          # regenerate data/ph-map.js from geojsonph
perl tools/build-standalone.pl   # bundle everything into one .html (for email/offline)
```
