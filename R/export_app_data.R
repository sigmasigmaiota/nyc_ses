# Export ACS tract data for the NYC SES Diversity Explorer (static web app).
#
# Writes data/ses_app_data.js (window.SES_DATA = {...}) containing, for each tract:
#   household income counts in the 16 B19001 brackets (+ MOEs), the same brackets for
#   white non-Hispanic households (B19001H), five race/ethnicity counts (B03002),
#   median income, a few other SES shares, county, CDTA and focus-area membership,
#   plus simplified tract, county and CDTA boundaries and the national B19001 counts.
# The browser recomputes ICE, entropy, the low x high classes and Theil's H from
# the counts, so the income thresholds can be changed in the app.
#
# Used two ways:
#   1. From ses_diversity_maps.Rmd (chunk "export-app"), with objects already in memory.
#   2. Stand-alone from the cached .rds files:  Rscript R/export_app_data.R <path/to/output/data> [app_dir]

suppressPackageStartupMessages({
  library(sf)
  library(dplyr)
  library(jsonlite)
})

export_app_data <- function(acs_raw, nat_raw, tracts_sf, county_sf, cdta,
                            app_dir = ".", acs_year = 2024,
                            simplify_ft = 30, digits = 5) {
  county_lu <- tibble::tribble(
    ~county_fips, ~county,
    "005", "Bronx",
    "047", "Brooklyn (Kings)",
    "061", "Manhattan (New York)",
    "081", "Queens",
    "085", "Staten Island (Richmond)",
    "059", "Nassau",
    "103", "Suffolk",
    "119", "Westchester")
  focus_nm <- sprintf("MN%02d", 9:12)
  focus_sb <- sprintf("BX%02d", 1:6)

  e  <- function(tbl, idx) sprintf("%s_%03dE", tbl, idx)
  m  <- function(tbl, idx) sprintf("%s_%03dM", tbl, idx)
  rs <- function(df, cols) rowSums(as.matrix(df[, cols, drop = FALSE]), na.rm = TRUE)
  r3 <- function(x) round(x, 3)

  d <- acs_raw |>
    mutate(county_fips = substr(GEOID, 3, 5),
           pop = B01003_001E, hh = B19001_001E) |>
    filter(pop >= 200, hh >= 50, county_fips %in% county_lu$county_fips)

  # --- tract -> CDTA (interior point), using the projected tract geometry
  tr <- tracts_sf |> filter(GEOID %in% d$GEOID)
  tr <- st_transform(tr, 2263)
  cd <- NULL
  tract_cdta <- tibble(GEOID = tr$GEOID, cdta4 = NA_character_)
  if (!is.null(cdta)) {
    code_col <- grep("^cdta2020$|^cdta$|^cdta_code$", names(cdta), ignore.case = TRUE, value = TRUE)[1]
    name_col <- grep("^cdtaname$|^cdta_name$", names(cdta), ignore.case = TRUE, value = TRUE)[1]
    cd <- cdta |>
      st_transform(2263) |>
      transmute(cdta4 = substr(.data[[code_col]], 1, 4), cdta_name = .data[[name_col]])
    pts <- suppressWarnings(st_point_on_surface(select(tr, GEOID)))
    tract_cdta <- st_join(pts, select(cd, cdta4)) |>
      st_drop_geometry() |>
      distinct(GEOID, .keep_all = TRUE)
  }
  d <- d |> left_join(tract_cdta, by = "GEOID") |>
    mutate(focus = case_when(cdta4 %in% focus_nm ~ 1L, cdta4 %in% focus_sb ~ 2L, TRUE ~ 0L))

  # --- tract records (compact arrays)
  safe_div <- function(a, b) ifelse(b > 0, a / b, NA)
  inc   <- as.matrix(d[, e("B19001", 2:17)])
  inc_m <- as.matrix(d[, m("B19001", 2:17)])
  incw  <- as.matrix(d[, e("B19001H", 2:17)])
  race  <- cbind(d$B03002_012E, d$B03002_004E, d$B03002_003E, d$B03002_006E,
                 rs(d, e("B03002", c(5, 7, 8, 9))))
  other <- tibble(
    gini   = d$B19083_001E,
    pov200 = safe_div(rs(d, e("C17002", 2:7)), d$C17002_001E),
    ba     = safe_div(rs(d, e("B15003", 22:25)), d$B15003_001E),
    rentb  = safe_div(rs(d, e("B25070", 7:10)), d$B25070_001E - d$B25070_011E),
    crowd  = safe_div(rs(d, e("B25014", c(5:7, 11:13))), d$B25014_001E))

  short_name <- sub(";.*", "", sub(",.*", "", d$NAME))   # "Census Tract 123.01"
  county_idx <- match(d$county_fips, county_lu$county_fips) - 1L

  tracts <- lapply(seq_len(nrow(d)), function(i) {
    list(id = d$GEOID[i], n = short_name[i], c = county_idx[i],
         d = if (is.na(d$cdta4[i])) "" else d$cdta4[i], f = d$focus[i],
         pop = d$pop[i], hh = d$hh[i], hhm = d$B19001_001M[i],
         b = unname(inc[i, ]), bm = unname(inc_m[i, ]), w = unname(incw[i, ]),
         r = unname(race[i, ]), rt = d$B03002_001E[i],
         mi = if (is.na(d$B19013_001E[i])) NULL else d$B19013_001E[i],
         mim = if (is.na(d$B19013_001M[i])) NULL else d$B19013_001M[i],
         o = unname(lapply(as.list(other[i, ]), \(x) if (is.na(x)) NULL else r3(x))))
  })

  # --- geometry: simplify in feet, then WGS84 GeoJSON with rounded coordinates
  to_geojson <- function(x, props) {
    x <- x |>
      st_simplify(preserveTopology = TRUE, dTolerance = simplify_ft) |>
      st_make_valid() |>
      st_transform(4326)
    x <- x[!st_is_empty(x), ]
    tf <- tempfile(fileext = ".geojson")
    st_write(x[, props], tf, driver = "GeoJSON", quiet = TRUE,
             layer_options = c(paste0("COORDINATE_PRECISION=", digits), "RFC7946=YES"))
    g <- fromJSON(tf, simplifyVector = FALSE)
    unlink(tf)
    g$name <- NULL; g$crs <- NULL
    # Simplification can leave stray points/lines inside GeometryCollections; keep polygon parts only
    g$features <- lapply(g$features, function(f) {
      if (identical(f$geometry$type, "GeometryCollection")) {
        parts <- Filter(function(p) p$type %in% c("Polygon", "MultiPolygon"), f$geometry$geometries)
        coords <- do.call(c, lapply(parts, function(p) if (p$type == "Polygon") list(p$coordinates) else p$coordinates))
        f$geometry <- list(type = "MultiPolygon", coordinates = coords)
      }
      f
    })
    g
  }
  tr_geo  <- tr |> semi_join(d, by = "GEOID") |> select(id = GEOID)
  geo_tr  <- to_geojson(tr_geo, "id")
  cty     <- county_sf |> st_transform(2263) |>
    filter(COUNTYFP %in% county_lu$county_fips) |> transmute(fips = COUNTYFP)
  geo_cty <- to_geojson(cty, "fips")
  geo_cd  <- if (!is.null(cd)) to_geojson(cd, c("cdta4", "cdta_name")) else NULL

  cdta_names <- if (!is.null(cd)) setNames(as.list(cd$cdta_name), cd$cdta4) else list()

  out <- list(
    meta = list(
      acs_year = acs_year, acs_span = sprintf("%d-%d", acs_year - 4, acs_year),
      generated = format(Sys.time(), "%Y-%m-%d"),
      counties = county_lu$county,
      brackets = c(0, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 100, 125, 150, 200) * 1000,
      us_bins = unname(unlist(nat_raw[1, e("B19001", 2:17)])),
      race_groups = c("Hispanic", "NH Black", "NH White", "NH Asian", "NH other/multiracial"),
      other_vars = names(other),
      focus = list(nm = focus_nm, sb = focus_sb),
      cdta_names = cdta_names),
    tracts = tracts,
    geo = list(tracts = geo_tr, counties = geo_cty, cdtas = geo_cd))

  dir.create(file.path(app_dir, "data"), showWarnings = FALSE, recursive = TRUE)
  f <- file.path(app_dir, "data", "ses_app_data.js")
  writeLines(c("// Generated by R/export_app_data.R - do not edit by hand.",
               paste0("window.SES_DATA = ",
                      toJSON(out, auto_unbox = TRUE, null = "null", na = "null", digits = NA),
                      ";")), f)
  message(sprintf("Wrote %s (%d tracts, %.1f MB)", f, length(tracts), file.size(f) / 1e6))

  # Single-file version (data + Leaflet + app inlined) for sharing without a server
  build_standalone(app_dir)
  invisible(f)
}

# Inline the <script src> / <link href> files that index.html references into one HTML file.
build_standalone <- function(app_dir = ".", out_file = "ses_explorer.html") {
  idx <- file.path(app_dir, "index.html")
  if (!file.exists(idx)) return(invisible(NULL))
  html <- readLines(idx, warn = FALSE, encoding = "UTF-8")
  read_file <- function(p) paste(readLines(file.path(app_dir, p), warn = FALSE, encoding = "UTF-8"),
                                 collapse = "\n")
  out <- character(0)
  for (line in html) {
    s <- regmatches(line, regexec('^\\s*<script src="([^"]+)"></script>\\s*$', line))[[1]]
    l <- regmatches(line, regexec('^\\s*<link rel="stylesheet" href="([^"]+)">\\s*$', line))[[1]]
    if (length(s) == 2 && !grepl("^https?:", s[2])) {
      out <- c(out, "<script>", gsub("</script", "<\\\\/script", read_file(s[2]), fixed = TRUE), "</script>")
    } else if (length(l) == 2 && !grepl("^https?:", l[2])) {
      out <- c(out, "<style>", read_file(l[2]), "</style>")
    } else {
      out <- c(out, line)
    }
  }
  f <- file.path(app_dir, out_file)
  writeLines(out, f, useBytes = TRUE)
  message(sprintf("Wrote %s (%.1f MB)", f, file.size(f) / 1e6))
  invisible(f)
}

# --- Stand-alone use: Rscript R/export_app_data.R <output/data dir> [app dir] [acs_year]
if (sys.nframe() == 0L) {
  args <- commandArgs(trailingOnly = TRUE)
  data_dir <- if (length(args) >= 1) args[1] else "output/data"
  app_dir  <- if (length(args) >= 2) args[2] else "."
  yr       <- if (length(args) >= 3) as.integer(args[3]) else 2024L
  rd <- function(f) readRDS(file.path(data_dir, f))
  export_app_data(
    acs_raw   = rd(sprintf("acs_tract_%d.rds", yr)),
    nat_raw   = rd(sprintf("acs_us_b19001_%d.rds", yr)),
    tracts_sf = rd(sprintf("tracts_sf_%d.rds", yr)),
    county_sf = rd(sprintf("county_sf_%d.rds", yr)),
    cdta      = if (file.exists(file.path(data_dir, "cdta_2020.rds"))) rd("cdta_2020.rds") else NULL,
    app_dir = app_dir, acs_year = yr)
}
