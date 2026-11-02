# NYC SES Diversity Explorer

An interactive, browser-only explorer of neighborhood income diversity across census tracts in the five NYC boroughs, Nassau, Suffolk and Westchester, with a focus on Northern Manhattan (MN09–MN12) and the South Bronx (BX01–BX06).

**Live site:** https://sigmasigmaiota.github.io/nyc_ses/

It compares three ways of measuring income diversity, with each other and with plain income and race/ethnicity maps:

| | Method | Question it answers |
|---|---|---|
| M1 | **ICE, income**: high-income share − low-income share | Is the tract tilted toward the top or bottom of the income distribution? |
| M2 | **Income entropy**: Shannon diversity across income groups, scaled 0–1 | How evenly are households spread across income groups? |
| M3 | **Low × high bivariate**: both shares, each compared with the US share | Is the tract mixed, middle-income, or concentrated at one end? |

The app recalculates everything in the browser from ACS tract counts, so you can change the low- and high-income cut points, the M3 tier width and the entropy groups, and every map, chart and table updates. The defaults reproduce `ses_diversity_maps.Rmd` exactly.

## What's in it

- **Two synchronized maps** with any measure on either side: the three methods, ICE race + income, median income, low- and high-income shares, largest race/ethnic group, each group's share, poverty, education, rent burden, crowding, Gini.
- **Plain-language explanations** of whatever is mapped, with the formula using the current cut points.
- **Area snapshot** for the selected area (all 8 counties, a single county, or the focus areas).
- **Tract details** on click: every measure, margins of error, and the tract's income distribution against the US.
- **Scatterplots** of each method against income and race/ethnicity shares, with Spearman's ρ, plus a low-vs-high chart that shows all three methods at once.
- **Summary table** by county, focus area and focus CDTA, including Theil's H for income and for race. Sortable, with CSV download.

The current view is saved in the URL, so a link reproduces exactly what you're looking at.

## Using it

- **Online:** open the live site.
- **Offline / share as one file:** download `ses_explorer.html` and open it in a browser. Data, code and Leaflet are inlined, so only the basemap tiles need an internet connection; the maps work without them.
- **From a clone:** open `index.html` directly. No server or build step is needed.

## Updating the data

`data/ses_app_data.js` is generated from the ACS data cached by the R Markdown report.

- **From the report:** keep this repository in a folder named `app` next to `ses_diversity_maps.Rmd`. The report's `export-app` chunk rewrites `app/data/ses_app_data.js` and `app/ses_explorer.html` on every knit.
- **Stand-alone, from the cached `.rds` files:**

  ```sh
  Rscript R/export_app_data.R "path/to/output/data" . 2024
  ```

  The arguments are the cache folder, this repo folder, and the ACS end year.

Requires R with `sf`, `dplyr` and `jsonlite`.

## Files

| Path | Contents |
|---|---|
| `index.html`, `css/app.css`, `js/app.js` | The app (plain HTML, CSS and JavaScript; no framework) |
| `vendor/` | Leaflet 1.9.4 |
| `data/ses_app_data.js` | Tract counts, margins of error and simplified boundaries (generated) |
| `ses_explorer.html` | Single-file build of all of the above (generated) |
| `R/export_app_data.R` | Builds the data file and the single-file version |
| `ses_methods.md` | Methods in plain language, worked examples and references |

## Data and methods

US Census Bureau, American Community Survey 2020–2024 5-year estimates: B19001, B19001H, B03002, B19013, B19083, C17002, B15003, B25070, B25014. Also TIGER/Line cartographic boundaries and NYC Department of City Planning 2020 Community District Tabulation Areas. Basemap tiles © Esri.

Income thresholds are national dollar amounts (defaults: under $30k and $150k or more), with no cost-of-living adjustment. Tracts with fewer than 200 residents or 50 households are excluded. See [`ses_methods.md`](ses_methods.md) for formulas, margin-of-error handling, caveats and sources.

---

S. Scott Jones · CUNY School of Medicine
