# Measuring income diversity across neighborhoods: methods in plain language

Companion to `ses_diversity_maps.Rmd`. It explains what each measure calculates, how to read it, where it can mislead, and where the method comes from, so the results can be checked and compared with published work.

**Geography.** Census tracts in the Bronx, Kings (Brooklyn), New York (Manhattan), Queens and Richmond (Staten Island) counties, plus Nassau, Suffolk and Westchester. The focus areas are Northern Manhattan (Community Districts MN09–MN12) and the South Bronx (BX01–BX06), matched using NYC's Community District Tabulation Areas (CDTAs).

**Data.** American Community Survey (ACS) 5-year estimates, tract level. Tracts with fewer than 200 residents or 50 households are dropped, which mostly removes parks, airports, cemeteries and Rikers Island.

---

## 1. Shared definitions

All three methods use the same income cut points, taken from ACS table B19001 (household income in 16 brackets):

| Term | Definition | B19001 brackets |
|---|---|---|
| Low-income household | income under $30,000 | 2–6 |
| High-income household | income $150,000 or more | 16–17 |
| Five income groups (for entropy) | under $30k · $30k–59.9k · $60k–99.9k · $100k–149.9k · $150k+ | 2–6 · 7–11 · 12–13 · 14–15 · 16–17 |

The thresholds are **national**. Each of the bottom and top groups holds roughly one-fifth of US households, which matches the ICE literature (Krieger et al. 2016 and Feldman et al. 2015 both set the cut points near the national 20th and 80th percentiles). The Rmd pulls the national B19001 table and prints the actual US shares, so you can check this for each ACS release.

Because the thresholds are national, they don't account for New York's higher cost of living. A $150,000 household in Manhattan is "high-income" here even though it may feel middle-class locally. This makes results comparable with other places and with published studies, at the cost of local meaning.

Two more terms:

- **p_low:** the share of a tract's households that are low-income.
- **p_high:** the share that are high-income.

All three methods are built from these two shares or from the five income groups.

---

## 2. Method 1: Index of Concentration at the Extremes (ICE)

### What it measures

Whether a tract's households lean toward the top or the bottom of the income distribution.

### Formula

```
ICE_income = (number of high-income households − number of low-income households) / total households
           = p_high − p_low
```

The range is −1 to +1:

- **−1:** every household is low-income.
- **+1:** every household is high-income.
- **0:** equal numbers of low- and high-income households.

### Worked example

A tract has 1,000 households: 400 earn under $30k and 100 earn $150k or more.
ICE = (100 − 400) / 1,000 = **−0.30**. The tract leans toward the low end.

### Race + income version

The Rmd also computes Krieger's combined measure, which counts high-income households that are white non-Hispanic and low-income households of color (all low-income households minus low-income white non-Hispanic households):

```
ICE_race+income = (high-income white NH households − low-income households of color) / total households
```

It uses table B19001H (household income for white alone, not Hispanic households) together with B19001.

### Limitation

**ICE can't distinguish a mixed tract from a middle-income tract.** A tract with 35% low-income and 35% high-income households and a tract with 5% of each both score 0, even though they're very different places. Methods 2 and 3 address this.

### Sources

- Massey DS. The prodigal paradigm returns: ecology comes back to sociology. In: Booth A, Crouter A, eds. *Does It Take a Village? Community Effects on Children, Adolescents, and Families.* Lawrence Erlbaum; 2001:41–48. (Original definition of ICE.) Summarized in the [PhenX Toolkit ICE protocol](https://www.phenxtoolkit.org/protocols/view/290801).
- Krieger N, Waterman PD, Spasojevic J, Li W, Maduro G, Van Wye G. Public health monitoring of privilege and deprivation with the Index of Concentration at the Extremes. *Am J Public Health.* 2016;106(2):256–263. [PMC4815605](https://pmc.ncbi.nlm.nih.gov/articles/PMC4815605/). (NYC tracts and community districts.)
- Feldman JM, Waterman PD, Coull BA, Krieger N. Spatial social polarisation: using the Index of Concentration at the Extremes jointly for income and race/ethnicity to analyse risk of hypertension. *J Epidemiol Community Health.* 2015;69(12):1199–1207. [PMC4878399](https://pmc.ncbi.nlm.nih.gov/articles/PMC4878399). (Lists the ACS tables for each ICE variant.)
- Larrabee Sonderlund A, Charifson M, et al. Racialized economic segregation and health outcomes: a systematic review of studies that use the Index of Concentration at the Extremes for race, income, and their interaction. *PLOS ONE.* 2022;17(1):e0262962. [IDEAS record](https://ideas.repec.org/a/plo/pone00/0262962.html).
- California Department of Public Health. [Index of Concentration at the Extremes: Data and Methods Narrative](https://www.cdph.ca.gov/Programs/OHE/CDPH%20Document%20Library/Index_of_Concentration_at_the_Extremes_Data_and_Methods_Narrative_ADA.pdf). (A health department's implementation, including how threshold choices affect results.)

---

## 3. Method 2: Income entropy (Shannon diversity)

### What it measures

How evenly a tract's households are spread across the five income groups, which is a direct measure of economic mixing.

### Formula

Let *p₁ … p₅* be the shares of the tract's households in each of the five income groups (they add up to 1).

```
H      = − Σ  p_k × ln(p_k)          (sum over the 5 groups; a group with p_k = 0 contributes 0)
H_norm = H / ln(5)
```

Dividing by ln(5), the largest possible value with five groups, rescales the score to run from 0 to 1:

- **0:** every household is in a single income group (no mixing).
- **1:** exactly 20% of households in each group (as evenly mixed as possible).

### Worked examples, comparing all three methods

These six hypothetical tracts show what each measure can and can't see:

| Tract | Shares in the 5 groups (low → high) | ICE | Entropy | Method 3 class |
|---|---|---|---|---|
| A. Concentrated low income | 70 / 20 / 7 / 2 / 1 % | −0.69 | 0.55 | Concentrated low |
| B. Mostly low, some spread | 40 / 25 / 15 / 10 / 10 % | −0.30 | 0.91 | Concentrated low |
| C. Middle-income | 5 / 15 / 60 / 15 / 5 % | 0.00 | 0.73 | Middle-income |
| D. Mixed / polarized | 35 / 10 / 10 / 10 / 35 % | 0.00 | 0.89 | Mixed |
| E. Even spread | 20 / 20 / 20 / 20 / 20 % | 0.00 | 1.00 | Middle tier on both axes |
| F. Concentrated high income | 2 / 5 / 10 / 18 / 65 % | +0.63 | 0.65 | Concentrated high |

What the table shows:

- **ICE** scores C, D and E the same (0), even though they're very different places.
- **Entropy** separates C (0.73) from D (0.89), but it ranks D below B. Entropy measures *spread*, not *which ends* households sit at, so a lopsided but spread-out tract (B) can score higher than a tract polarized between rich and poor (D).
- **Method 3** is the only one that names D as "mixed" and C as "middle-income."

No single number captures everything, which is why the Rmd shows all three.

### Notes

- **Why five groups instead of all 16 brackets.** The 16 ACS brackets are narrow at the bottom ($5k wide) and wide at the top. Computed on all 16, a uniformly poor tract can look diverse just because its households fall into several narrow low-income brackets. The five groups are roughly equal-sized nationally, so "even" means "a cross-section of US incomes." The Rmd also calculates the 16-bracket version (`income_entropy16`) and prints its correlation with the 5-group version as a sensitivity check.
- Entropy describes a single tract. To ask how *segregated* a whole county is, which is a different question, see Section 6.

### Sources

- Shannon CE. A mathematical theory of communication. *Bell Syst Tech J.* 1948;27(3):379–423. (The entropy formula.)
- White MJ. Segregation and diversity measures in population distribution. *Population Index.* 1986;52(2):198–221. [PubMed 12340704](https://pubmed.ncbi.nlm.nih.gov/12340704/). (Entropy as a diversity measure for areas.)
- Reardon SF, Firebaugh G. Measures of multigroup segregation. *Sociological Methodology.* 2002;32:33–67. [Record](https://pure.psu.edu/en/publications/measures-of-multigroup-segregation/). (Entropy-based diversity and segregation measures compared.)
- US Census Bureau. [Housing Patterns: Multi-Group Entropy Index](https://www.census.gov/topics/housing/housing-patterns/about/multi-group-entropy-index.html). (The Census Bureau's own use of entropy "diversity scores.")

---

## 4. Method 3: Low-income × high-income bivariate map

### What it measures

The low-income share and the high-income share at the same time, so you can see whether a tract is middle-income, mixed, or concentrated at one end.

### Formula

Each tract gets two numbers, *p_low* and *p_high* (Section 1). Each is sorted into three tiers relative to the **national** share of households in that group:

| Tier | Rule |
|---|---|
| 1 (below) | more than 5 percentage points below the US share |
| 2 (near) | within ±5 points of the US share |
| 3 (above) | more than 5 points above the US share |

The two tiers combine into one of nine classes, written "low tier–high tier." The four corners are the clearest cases:

| Class | Meaning | Map color |
|---|---|---|
| 1–1 | few low- *and* few high-income households → **middle-income** | light gray |
| 3–1 | many low-income, few high-income → **concentrated low income** | teal |
| 1–3 | few low-income, many high-income → **concentrated high income** | pink |
| 3–3 | many low- *and* many high-income households → **mixed** | dark blue-purple |

The middle tiers are blends between these. The Rmd prints the exact percentage cut points for the ACS release you use.

### How it relates to ICE

ICE equals *p_high − p_low*, so on the low-vs-high scatterplot (`09_scatter_low_vs_high.png`), every diagonal line is a line of constant ICE. ICE only records which diagonal a tract sits on. Method 3 also records *where along the diagonal* it sits: near the origin (middle-income) or out toward the upper right (mixed).

### Why national tiers instead of quantiles

Many bivariate maps split each variable into thirds of the mapped tracts. That maximizes color contrast, but the meaning of each class then depends on which counties are included. Anchoring the tiers to the national share means a class means the same thing on the region map, each county map and the focus map, and matches the national ICE thresholds. The trade-off is that in a high-income region many tracts land in the top high-income tier.

### Reliability

Small shares in small tracts have wide margins of error. Tracts where either share's 90% margin of error exceeds ±10 percentage points get a dotted outline (Section 7).

### Sources

- Stevens J. Bivariate choropleth maps: a how-to guide. 2015. Discussed at [FlowingData](https://flowingdata.com/2015/03/13/bivariate-choropleth-how-to). (Source of the 3×3 color scheme.)
- Prener C, Grossenbacher T, Zehr A. *biscale: Tools and Palettes for Bivariate Thematic Mapping.* R package. [CRAN vignette](https://cran.r-project.org/web/packages/biscale/vignettes/biscale.html). (Used for the income × education map. The low × high classes are built directly in the Rmd so that the national cut points can be used.)

---

## 5. Reference maps: plain income and plain race/ethnicity

The three methods are compared against two plain maps.

### Median household income

ACS B19013. The ACS top-codes this value at $250,001, so the wealthiest tracts all share the top color. Dotted outlines mark tracts whose coefficient of variation exceeds 30%.

### Race/ethnicity

ACS B03002, in five mutually exclusive groups:

- Hispanic (any race)
- non-Hispanic (NH) Black
- NH White
- NH Asian
- NH other/multiracial (American Indian/Alaska Native, Native Hawaiian/Pacific Islander, some other race, two or more races)

The comparison pages show each tract's **largest group**: dark shading if that group is a majority (50% or more), light if it's only a plurality. Separate maps (`06_race_composition_*.png`) show each group's share, so the plurality map's simplification can be checked.

### How the comparison works

- **Side-by-side maps** (`07_compare_*.png`), for the region, each county and the focus area.
- **Scatterplots** (`08_scatter_methods_vs_income_race.png`): each method plotted against log median income and each race/ethnicity share. The Spearman rank correlation (ρ) is printed in every panel.
- **A low-vs-high scatterplot** (`09`) that shows all three methods together.

Strong correlations with median income are expected for ICE and for the two Method 3 shares, because they're built from the same income table. Entropy usually peaks at middle incomes and falls at both extremes, so a straight-line correlation understates how closely it's tied to income. The correlations with race shares show how closely economic position follows racial composition in this region. They don't explain why.

---

## 6. Area summaries: pooled measures and Theil's H

`summary_by_area.csv` describes each county, the two focus areas and each focus CDTA:

- **Pooled ICE and pooled entropy.** These are computed from the area's *total* counts, treating the county as one big neighborhood.
- **Mean tract entropy.** The household-weighted average of the tract entropies.
- **Theil's H, the information theory index of segregation:**

  ```
  H = Σ over tracts i of  [ t_i × (E − E_i) ] / (T × E)
  ```

  Here *E* is the entropy of the whole area, *E_i* the entropy of tract *i*, *t_i* the tract's households (or people, for race), and *T* the area total. Both entropies use natural logs and are not normalized.

  In plain terms, H measures how much less diverse the typical tract is than the area as a whole:
  - **H = 0:** every tract has the same mix as the county (no segregation).
  - **H = 1:** each tract contains only one group (complete segregation).

  The Rmd calculates H twice, for the five income groups and for the five race/ethnicity groups, so you can see whether an area is more sorted by income or by race.
- **Share of households by Method 3 class.** The percent of the area's households living in mixed, middle-income, concentrated-low and concentrated-high tracts.

A county can have high pooled entropy (a diverse county overall) together with a high Theil's H (that diversity is sorted into separate neighborhoods). Manhattan is the classic example.

### Sources

- Theil H, Finizza AJ. A note on the measurement of racial integration of schools by means of informational concepts. *J Math Sociol.* 1971;1(2):187–193.
- Reardon SF, Firebaugh G. 2002 (above): the definitive comparison of multigroup segregation indices.
- Reardon SF, Bischoff K. Income inequality and income segregation. *Am J Sociol.* 2011;116(4):1092–1153. [PDF](https://cepa.stanford.edu/sites/default/files/reardon%20&%20bischoff%20income%20inequality%20segregation%20AJS%20final.pdf). (Applies information-theory segregation measures to income. Its rank-order version avoids depending on bracket choice and is a refinement to consider.)
- US Census Bureau, [Multi-Group Entropy Index](https://www.census.gov/topics/housing/housing-patterns/about/multi-group-entropy-index.html) (above).
- To cross-check: the R package `segregation` (Elbers B) computes entropy, Theil's H and the related mutual information index *M* from the same count tables. Elbers B. A method for studying differences in segregation across time and space. *Sociol Methods Res.* 2023;52(1):5–42.

---

## 7. Margins of error

ACS estimates come from a sample, so every count has a 90% margin of error (MOE). The Rmd uses the Census Bureau's standard approximations:

```
MOE of a sum of brackets      = √(MOE₁² + MOE₂² + …)
MOE of a proportion p = X / Y = √(MOE_X² − p² × MOE_Y²) / Y
      (if the term under the root is negative, use + instead of −)
Standard error                 = MOE / 1.645
Coefficient of variation (CV)  = SE / estimate
```

These feed two flags:

- **Median income:** dotted outline when CV > 30%.
- **Method 3:** dotted outline when the MOE of either share exceeds ±10 percentage points.

The sum formula is a simplification that can overstate error when many brackets are zero, so the flags lean cautious.

Margins of error are **not** propagated into ICE, entropy or Theil's H. Treat small differences between neighboring tracts as noise.

**Source:** US Census Bureau. *Understanding and Using American Community Survey Data: What All Data Users Need to Know.* Chapter 8, "Calculating Measures of Error for Derived Estimates." 2018. [PDF](https://www.census.gov/content/dam/Census/library/publications/2018/acs/acs_general_handbook_2018_ch08.pdf).

---

## 8. Other caveats

- **Tracts aren't neighborhoods.** People experience a neighborhood that crosses tract lines. The local-contrast map (`04`) and the CDTA summaries help show the larger scale.
- **These are descriptive maps.** None of them is adjusted for income or anything else. They describe the economic and racial makeup of places; they don't explain health or other outcomes.
- **Ecological inference.** A mixed tract doesn't mean low- and high-income residents interact. A tract's race and income shares don't describe any individual resident.
- **5-year estimates span five years.** A 2020–2024 estimate blends the pandemic years and may lag rapid change, such as gentrification in Harlem or the South Bronx waterfront.

---

## 9. Geography and data sources

- US Census Bureau, American Community Survey 5-year estimates: tables B19001, B19001H, B03002, B19013, B19083, C17002, B15003, B23025, B25070, B25014, B19058. Retrieved with the `tidycensus` R package (Walker K, Herman M).
- US Census Bureau, TIGER/Line cartographic boundary files (tracts, counties), via `tigris`, with water areas removed.
- NYC Department of City Planning, [2020 Community District Tabulation Areas](https://catalog.data.gov/dataset/2020-community-district-tabulation-areas-cdtas). CDTAs are built from whole 2020 census tracts.
- Optional health outcomes: CDC PLACES tract estimates (BRFSS-based small-area estimates), [methodology](https://www.cdc.gov/places/methodology/).
- For background on NYC's standard area-based poverty measure: NYC DOHMH, [Selecting and Applying a Standard Area-based Socioeconomic Status Measure for Public Health Data: Analysis for New York City](https://www.nyc.gov/assets/doh/downloads/pdf/epi/epiresearch-SES-measure.pdf), 2013.
