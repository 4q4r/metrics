# Shikimori plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained `shikimori` plugin to the metrics fork that renders Shikimori profile data (favorites, characters/people strips, status lists, stats, achievements, genres) with per-field display configurability, in the AniList visual language.

**Architecture:** Hybrid anonymous client — GraphQL (`https://shikimori.io/api/graphql`) for user lists (`userRates`) and card data, REST v1 (`https://shikimori.io/api/...`) for favourites, achievements, profile stats. Data formatted into pinned result shapes; a new EJS partial in the `classic` template renders them with a `.shikimori`-scoped CSS block. New graphical elements follow D12: Stitch mockups → Vision harmony check → implement → Vision `ui_diff_check`.

**Tech Stack:** Node 20 ESM (repo runs 22 locally), axios, EJS, jest, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-shikimori-design.md` (D1–D17 binding)

## Global Constraints

- Base URL `https://shikimori.io` everywhere (`.one` is a 301/308 redirector — never use it).
- Every axios request (POST + GET) sends `{"User-Agent": "metrics"}` in headers.
- Anonymous traffic only: no tokens, no OAuth, no secrets in examples/workflows.
- Rate limits 5 rps / 90 rpm: retry ONLY limit responses (429) using anilist's `retry()` pattern (`retry-after` header + 5s); everything else throws into `imports.format.error(error)`.
- GraphQL `userRates` `limit` clamps to 50/page — paginate with `page` when fetching beyond that.
- `order` is an input object `{field: id|updated_at, order: asc|desc}`; `site` sort = `{field: "id", order: "asc"}`.
- No slang anywhere: identifiers, comments, user-visible strings, docs — "Shikimori", never "shiki".
- Zero changes to core: `source/plugins/core/`, `source/app/` untouched. Allowed files: `source/plugins/shikimori/**`, `source/templates/classic/{partials/shikimori.ejs, partials/_.json, style.css}`, `tests/**`, `settings.example.json`, `source/app/web/statics/embed/app.placeholder.js`, `.github/{workflows/examples.yml, config/label.yml}`, regenerated `action.yml`/`README.md`, plugin `README.md`.
- English section headers in the partial, AniList-consistent wording.
- Work happens on branch `feat/shikimori-plugin` off `origin/master` in worktree `/tmp/metrics-wt01`.
- Toolchain: **bun, never npm/npx** — deps via `bun install`, scripts via `bun run <script>`, jest via `bunx jest …` (`bun test` is a different runner — forbidden).

## Result data shape (the contract every task builds on)

```js
{
  user: { id, nickname },
  sections: [/* pass-through of plugin_shikimori_sections */],
  lists:   { [media]: { [status]: [card] } },      // media: anime | manga | ranobe; status: the 6 enum values
  favorites: { [media]: [card] },                  // media: anime | manga | ranobe
  characters: [ { name, artwork } ],
  people:    { [kind]: [ { name, artwork } ] },    // kind: people | seyu | mangakas | producers, insertion order = config order
  stats: {
    summary: { episodes, chapters } | null,        // null unless stats.summary display field enabled
    statuses: [ { name, value } ],                 // anime+manga counts summed per status
    scores: { anime: [ { name, value } ], manga: [ { name, value } ] },   // v1 histogram as-is
    activity: [ { from, to, value } ],             // native ≈178.6-day buckets
  },
  achievements: [ { neko_id, level, progress, icon } ],   // icon: resolved URL string or null (falls back to chip)
  genres: [/* genre name strings, top 8 by v1 stats.genres value */],
}
// card (consumed by partial and placeholder, mirrors anilist card):
{
  name,          // title per plugin_shikimori_title_language
  type,          // "ANIME" | "MANGA" (ranobe → "MANGA")
  status,        // lowercase shikimori media status: anons | ongoing | released
  release,       // year (airedOn.year ?? releasedOn.year)
  genres,        // [name strings]
  studio,        // first studio name (anime only, else null)
  progress,      // consumed episodes/chapters (lists only; null for favorites)
  volumes,       // consumed volumes (lists, manga only; else null)
  description,   // plain text, HTML tags stripped
  scores: { user, community },   // community = GraphQL score (decimal); user = userRate score (null for favorites)
  released,      // total: episodes (anime) / chapters (manga)
  artwork,       // base64 data URI via imports.imgb64
}
```

Display-field semantics (spec §5): a display input is a comma-separated allowlist of card/module fields; absent = hidden. Unknown values are dropped at parse time (fail-soft). Empty allowlist → module body renders empty (header stays). `sort` applies to `lists[media][status]` and `favorites[media]` arrays: `score` = `scores.community` desc (fallback `scores.user`), `release` = `release` desc, `updated` = lists API order `{field: "updated_at", order: "desc"}` / favorites falls back to site order. `shuffle` applies only when `sort == "site"` (anilist semantics: shuffle then cut to limit).

---

### Task 1: Plugin skeleton — metadata, queries, data layer (lists, favorites, characters, people)

**Files:**
- Create: `source/plugins/shikimori/metadata.yml`
- Create: `source/plugins/shikimori/queries/lists.graphql`, `source/plugins/shikimori/queries/favorites-medias.graphql`
- Create: `source/plugins/shikimori/index.mjs`
- Create: `tests/mocks/api/axios/post/shikimori.mjs`, `tests/mocks/api/axios/get/shikimori.mjs`
- Create: `tests/cases/shikimori.plugin.yml`

**Interfaces:**
- Consumes (repo, read-only reference): anilist plugin structure (`source/plugins/anilist/index.mjs` signature, `imports.{axios,imgb64,shuffle,wait,format.error,metadata}`); query loader contract: `queries.shikimori.<file>(vars)` returns the `.graphql` file content with `$key` → value replacement.
- Produces: plugin entry `export default async function({login, data, queries, imports, q, account}, {enabled, extras})` returning the Result data shape (sections `favorites`, `characters`, `people`, `lists`; `stats`, `achievements`, `genres` keys present but `{}/[]/null` — filled by Task 2). Metadata defines ALL inputs (Task 2/4/6 depend on exact names below).

**Exact input names and defaults (metadata.yml — all of them, verbatim):**

| Input | Type | Default | Values |
|---|---|---|---|
| `plugin_shikimori` | boolean | no | — (extras: `[metrics.run.puppeteer.scrapping]`) |
| `plugin_shikimori_user` | string | `.user.login` | — |
| `plugin_shikimori_medias` | array comma-sep | `anime, manga` | anime, manga, ranobe |
| `plugin_shikimori_sections` | array comma-sep | `favorites` | favorites, characters, people, lists, stats, achievements, genres |
| `plugin_shikimori_statuses` | array comma-sep | `watching` | planned, watching, rewatching, completed, on_hold, dropped |
| `plugin_shikimori_people` | array comma-sep | `people, seyu` | people, seyu, mangakas, producers |
| `plugin_shikimori_achievements_filter` | enum | earned | earned, all |
| `plugin_shikimori_sort` | enum | site | site, score, release, updated |
| `plugin_shikimori_title_language` | enum | english | english, russian, japanese |
| `plugin_shikimori_score` | enum | community | community, user, both, off |
| `plugin_shikimori_limit` | number | 2 | min 0 (0 = disable) |
| `plugin_shikimori_limit_characters` | number | 22 | min 0 |
| `plugin_shikimori_limit_people` | number | 22 | min 0 |
| `plugin_shikimori_limit_achievements` | number | 22 | min 0 |
| `plugin_shikimori_shuffle` | boolean | yes | — |
| `plugin_shikimori_display_favorites` | array comma-sep | `cover, title, description, score, year, status, genres, type` | cover, title, description, score, progress, user_score, year, status, genres, studio, type |
| `plugin_shikimori_display_lists` | array comma-sep | `cover, title, description, score, progress, year, status, genres, type` | (same values) |
| `plugin_shikimori_display_stats` | array comma-sep | `summary, statuses, distribution, activity` | summary, statuses, distribution, activity |
| `plugin_shikimori_display_achievements` | array comma-sep | `icons, chips` | icons, chips |

Header/name/genre/category metadata mirrors anilist (`name: 🎴 Shikimori watch list and reading list`, category `social`, supports user+organization, scopes `[]`, disclaimer non-affiliation).

**Exact behavior:**

1. User resolution: `GET https://shikimori.io/api/users?search=<user>&limit=1` (with UA header) → `{id, nickname}`; no result → throw error mentioning the nickname.
2. `lists` section: for each selected media × status: GraphQL POST `https://shikimori.io/api/graphql` body `{query: queries.shikimori.lists({...}), variables}` against `userRates`; pagination loop while a full 50-entry page returns and more may exist, hard cap 10 pages per (media,status); `ranobe` = `targetType: Manga` rates where nested `manga.kind == "light_novel"`. Enum type names in the query doc must be verified by introspection before finalize (`UserRateStatusEnum`, `UserRateTargetTypeEnum`, `UserRateOrderInputType` — confirm exact spelling).
3. `favorites` section: `GET /api/users/:id/favourites` → for media `anime|manga|ranobe` take `animes|mangas|ranobe` key arrays (ranobe ids belong to manga entities); batch-resolve card data in ONE GraphQL call per media via `queries.shikimori.favorites-medias({ids})` against `animes(ids:)` / `mangas(ids:)`; preserve the v1 response order (site order). Card artwork: favourites images are relative (`/system/...`) → prefix `https://shikimori.io` before `imports.imgb64`; GraphQL `poster { originalUrl }` is absolute already. Characters/people strips come straight from the v1 favourites response (`image` prefixed, `imports.imgb64`), cut to their limits, `people` keys filtered by `plugin_shikimori_people` config order.
4. Sorting/shuffle/cut per Global Constraints semantics; `scores.user` present only for list entries; `plugin_shikimori_score` filters what ends up in `card.scores` (`community` → `{user: null, community}`, `user` → inverse, `both`, `off` → `{user: null, community: null}`).
5. `title_language` mapping: `english` → `english ?? name`, `russian` → `russian ?? name`, `japanese` → `japanese ?? name`.
6. Errors follow anilist: single try/catch → `throw imports.format.error(error)`.

**Steps:**

- [ ] 1. Create branch: `git fetch origin && git checkout -b feat/shikimori-plugin origin/master` in worktree `/tmp/metrics-wt01` (create via `git worktree add /tmp/metrics-wt01 origin/master` from the main checkout first).
- [ ] 2. Verify the three GraphQL enum type names + `UserRate` pagination response shape by introspection/live probe (read-only; UA header; ≤5 rps). Record findings in the task report.
- [ ] 3. Write `metadata.yml` with the exact input table above (mirror anilist formatting conventions).
- [ ] 4. Write `queries/lists.graphql` and `queries/favorites-medias.graphql` (see Exact behavior for shapes/fields; fields: `name russian english japanese kind status airedOn { year } releasedOn { year } episodes chapters volumes score description genres { name } studios { name } poster { originalUrl }` + UserRate entry fields `id score status episodes chapters volumes`).
- [ ] 5. Write `tests/mocks/api/axios/post/shikimori.mjs` and `tests/mocks/api/axios/get/shikimori.mjs` following the anilist mock contract (`export default function({faker, url, body, login})`, POST matches `/^https:..shikimori\.io\.api\.graphql.*$/` and branches on `/^query Lists /` / `/^query FavoritesMedias /`; GET branches on `/api/users\?search=`, `/api/users/\d+/favourites`, `/api/achievements\?user_id=`, `/api/users/\d+$` — include ALL v1 shapes even those Task 2 consumes: favourites all 8 keys, achievements array, profile stats). Artwork URLs in mocks: `null` (repo convention — anilist mocks use null images).
- [ ] 6. Write failing test cases `tests/cases/shikimori.plugin.yml`: (a) favorites anime, (b) favorites manga + ranobe, (c) lists watching + completed with limit 2, (d) characters + people (`seyu, mangakas`), all with `plugin_shikimori: 'yes'`, `plugin_shikimori_user: whynothacked`, `use_mocked_data: 'yes'`, `verify: 'yes'`, mirroring `tests/cases/anilist.plugin.yml` shape.
- [ ] 7. Run `bunx jest --runInBand metrics.test.js -t "Shikimori"` → expect FAIL (plugin not implemented).
- [ ] 8. Implement `source/plugins/shikimori/index.mjs` per Exact behavior (signature mirrors anilist; sections `stats`/`achievements`/`genres` return empty placeholders).
- [ ] 9. Run `bunx jest --runInBand metrics.test.js -t "Shikimori"` → expect PASS for cases (a)–(d) (GitHub Action mode; Web/placeholder modes may still fail — acceptable at this task, fixed by Tasks 4/5).
- [ ] 10. `bun run linter` → 0 errors on new files. Commit: `feat(shikimori): plugin skeleton with lists, favorites and strips data layer`.

---

### Task 2: Data layer — stats, achievements, genres (+ summary summation, achievement icons)

**Files:**
- Modify: `source/plugins/shikimori/index.mjs`
- Create: `source/plugins/shikimori/neko-groups.json` (static neko_id → group map)
- Modify: `tests/mocks/api/axios/get/shikimori.mjs` (realistic `stats` + achievements shapes if Task 1 left them minimal)
- Modify: `tests/cases/shikimori.plugin.yml` (add cases (e) stats + genres, (f) achievements)

**Interfaces:**
- Consumes: Task 1 plugin skeleton, Result data shape (`stats`, `achievements`, `genres` keys), v1 GET mocks from Task 1.
- Produces: filled `stats`, `achievements`, `genres` per Result data shape. Achievement icon resolution helper (internal): `icon = https://shikimori.io/assets/achievements/<group>/<neko_id>_<level>.jpg` (franchise exception: `<group>/franchise/<neko_id>.png`), group from `neko-groups.json`; unresolvable group or failed fetch → `icon: null`.

**Exact behavior:**

1. `stats.statuses`: v1 profile `stats.statuses` (`anime` + `manga` arrays of `{name, value}` — verify exact nesting via the live probe from Task 1 step 2) summed per status name across types.
2. `stats.summary`: only when `plugin_shikimori_display_stats` includes `summary` — paginate `userRates` over BOTH target types (all 6 statuses, `order: {field: "id", order: "asc"}`, 50/page, hard cap 60 pages total) summing `episodes` and `chapters` (chapters = manga entries; ranobe rates are manga and counted). Otherwise `summary: null`.
3. `stats.scores` + `stats.activity`: pass-through from v1 profile `stats.scores` / `stats.activity` (map activity entries to `{from, to, value}`).
4. `genres`: v1 profile `stats.genres` sorted by `value` desc, top 8, name strings.
5. `achievements`: `GET /api/achievements?user_id=:id`; filter by `plugin_shikimori_achievements_filter` (`earned` → `level >= 1`, `all` → everything); sort `level` desc then `progress` desc; cut to `plugin_shikimori_limit_achievements` — cut is applied to the icons list while chips data (neko_id/level/progress) is computed for the same entries; icon resolution per Interfaces.

**Steps:**

- [ ] 1. Extract neko_id → group map from the Shikimori open-source repo (`https://github.com/shikimori/shikimori`, neko achievements definitions) into `neko-groups.json`; record extraction date + source commit in the task report.
- [ ] 2. Add jest cases (e) `sections: stats, genres` and (f) `sections: achievements` (both display variants: `display_achievements: icons` and `chips`) to `tests/cases/shikimori.plugin.yml`; run `-t "Shikimori"` → FAIL.
- [ ] 3. Implement stats/achievements/genres in `index.mjs` per Exact behavior; adjust GET mocks only if their shapes don't match the verified v1 reality.
- [ ] 4. `bunx jest --runInBand metrics.test.js -t "Shikimori"` → PASS (action mode). `bun run linter` → 0 errors. Commit: `feat(shikimori): stats, achievements and genres data`.

---

### Task 3: Stitch mockups for the three new graphical elements (D12)

**Files:**
- Create (workspace only, NOT in repo): `/tmp/metrics-scratch-shikimori/mockups/{chips,badges,miniblock}.png` + `/tmp/metrics-scratch-shikimori/design-tokens.md`

**Interfaces:**
- Consumes: `source/templates/classic/style.css` (AniList block 972–1041: card 450px, cover 48×72 radius 7, `.media .name` 14px #58a6ff, `.infos` 12px #666), anilist partial markup, Result data shape (status chips `{name, value}`, achievements `{neko_id, level, progress, icon}`, stats mini-block `scores` histogram + activity buckets), partial section layout plan from Task 4.
- Produces: three approved mockup PNGs + `design-tokens.md` (exact colors, sizes, class names for: `.shikimori .statuses .chip`, `.shikimori .achievements .badge / .badge.chip-only`, `.shikimori .stats-block` distribution bars + activity buckets) — Task 4 implements CSS from these tokens verbatim; Task 7 runs `ui_diff_check` against the PNGs.

**Steps:**

- [ ] 1. Dispatch a UI-designer subagent (D12 mandate): it loads skills per the dispatch contract, reads the classic template CSS + anilist partial + Result data shape, passes styles/formats/sizes to Stitch, and produces the three mockups. Sub-agents report mockup paths + tokens file.
- [ ] 2. Harmony check: render the current anilist SVG (mocked, `plugin_anilist` case) and compare mockups vs existing design via Z.AI Vision MCP (`analyze_image` on each mockup against the rendered anilist SVG); verdict per mockup: harmonious / rejected with reasons. Rejected → one revision round with the Vision findings.
- [ ] 3. Record verdicts + tokens in the ledger. Commit nothing (workspace artifacts only).

---

### Task 4: Rendering — classic template partial, partials index, `.shikimori` CSS block

**Files:**
- Create: `source/templates/classic/partials/shikimori.ejs`
- Modify: `source/templates/classic/partials/_.json` (add `"shikimori"` right after `"anilist"`)
- Modify: `source/templates/classic/style.css` (new `/* Shikimori */` block after the `/* Anilist */` block, before `/* Steam */`)

**Interfaces:**
- Consumes: Result data shape + card shape (Tasks 1–2), design tokens (Task 3), anilist partial vocabulary (`plugins.<name>`, `<section>`, `h2.field`, `.row`, `.medias.largeable-flex-wrap`, `.media.largeable-width-half`, `.about/.infos/.description`, `.characters`, error block pattern, `f()`/`s()` pluralization helpers).
- Produces: rendered `<section>` for `plugins.shikimori`; all sections honor their display inputs; placeholder task (Task 5) must emit the same shape.

**Exact behavior:**

1. Header icon: bookmark SVG like anilist, label `Shikimori`. Error block mirrors anilist (`plugins.shikimori.error.message`).
2. Sections in this order: genres line (AniList "Favorites genres" analog), stats summary line ("N episodes watched / M chapters read"), status chips, lists blocks per media+status (headers `Favorites animes` / `Currently watching` / `Planned` / ...), favorites blocks, characters strip, people strips (per `people` config order, headers `Favorites seyu` etc.), stats mini-block (distribution + native activity buckets), achievements (icons strip and/or chips per display input).
3. Every card field wrapped in its display-input check; score rendered as-is (decimal, no `%`); status label map `{anons: "Not yet released", ongoing: "(releasing)", released: ""}`; ranobe/manga icon = Manga branch.
4. CSS: `.shikimori` block mirrors the `.anilist` block (450px cards, 48×72 covers, strips) + the three new elements styled exactly per `design-tokens.md`.

**Steps:**

- [ ] 1. Write `shikimori.ejs` per Exact behavior (guard every section with `sections.includes(...)` and display-input membership, like the anilist partial does for `sections`).
- [ ] 2. Register `"shikimori"` in `partials/_.json` after `"anilist"`; add the CSS block.
- [ ] 3. `bunx jest --runInBand metrics.test.js -t "Shikimori"` → action + web modes PASS (placeholder mode may still fail → Task 5). Render one mocked SVG locally (`dryrun` via the action runner used by jest is enough — jest already proves it) and capture a screenshot for the ledger.
- [ ] 4. `bun run linter` → 0 errors. Commit: `feat(shikimori): classic template partial and scoped styles`.

---

### Task 5: Web instance placeholder mocks

**Files:**
- Modify: `source/app/web/statics/embed/app.placeholder.js`

**Interfaces:**
- Consumes: Result data shape (must mirror it with faker data, reading `options["shikimori.<input>"]` — keys without the `plugin_` prefix, dots for underscores), anilist placeholder block (lines ~975–1037) as the structural reference.
- Produces: placeholder mode passes for all `tests/cases/shikimori.plugin.yml` cases (auto-scanned by `tests/metrics.test.js` "Web instance (placeholder)" describe).

**Steps:**

- [ ] 1. Add a `//Shikimori` block gated on `set.plugins.enabled.shikimori`, emitting the full Result data shape with faker (1×1 PNG data-URI artwork like anilist), honoring `sections`, `medias`, `statuses`, `people`, `limit*` options.
- [ ] 2. `bunx jest --runInBand metrics.test.js -t "Shikimori"` → ALL THREE modes PASS.
- [ ] 3. `bun run linter` → 0 errors. Commit: `feat(shikimori): web instance placeholder mocks`.

---

### Task 6: Registries, examples, manifest regeneration

**Files:**
- Modify: `settings.example.json` (add `"shikimori": {"enabled": false, "//": "Enable Shikimori plugin"}` next to anilist)
- Create: `source/plugins/shikimori/examples.yml` (3 examples: favorites+watching, manga+ranobe favorites, achievements+stats; `filename: metrics.plugin.shikimori*.svg`, `token: NOT_NEEDED`, `base: ""`, `user: whynothacked`)
- Modify: `.github/workflows/examples.yml` (mirror the plugin examples as jobs: `uses: lowlighter/metrics@master`, `output_action: none`, `delay: 120`, `user: whynothacked`, `plugins_errors_fatal: yes`, `if: success() || failure()`)
- Modify: `.github/config/label.yml` (`🎴 plugin shikimori:` → `- source/plugins/shikimori/**`)
- Create: `source/plugins/shikimori/README.md` (mirror anilist README structure: description, inputs table from Task 1 metadata)
- Regenerated: `action.yml` + `README.md` (by build script)

**Interfaces:**
- Consumes: final metadata.yml input list (Task 1).
- Produces: regenerated `action.yml` containing all `plugin_shikimori_*` inputs; README plugin indexes updated.

**Steps:**

- [ ] 1. Write settings/label/README/examples/workflow entries following the anilist reference blocks verbatim in structure.
- [ ] 2. Run `bun run build -- publish`; verify `git diff --stat` shows regenerated `action.yml` + `README.md` (+ `settings.example.json` indexes if the script touches them); commit the regenerated artifacts together with the hand-written ones: `feat(shikimori): registries, examples and manifest regeneration`.
- [ ] 3. `bunx jest --runInBand ci.test.js` → PASS (it validates manifest/tests consistency).

---

### Task 7: Final gates, live smoke, visual diff, PR

**Files:** none new (verification task)

**Interfaces:**
- Consumes: everything above; Task 3 mockup PNGs; owner nickname `whynothacked` (D17).
- Produces: green whole-branch state + PR.

**Steps:**

- [ ] 1. Full gates, standalone, in this order (each blocking): `bun run linter` → 0 errors; `bun test` is NOT used (that is bun's own runner); full suite = `bun run test` → all PASS (includes all three Shikimori modes across all templates); `bun run build -- publish` → clean regen (`git diff` empty afterwards).
- [ ] 2. Live smoke (read-only, UA `metrics`, ≤5 rps): run the action with real Shikimori data for `plugin_shikimori_user: whynothacked` (no mocks, dryrun) → SVG renders without error block; capture PNG screenshots of the SVG at representative viewport.
- [ ] 3. Vision MCP `ui_diff_check` (D12): implementation screenshots vs Task 3 mockups (chips, badges, mini-block) → verdicts; deviations → fix round via dispatch, re-check after fix.
- [ ] 4. Push branch (`git push -u origin feat/shikimori-plugin`; verify `git ls-remote origin feat/shikimori-plugin` matches local HEAD), open PR against `master`, wait for CodeRabbit + reviewer subagent, address findings, read full PR thread, then squash-merge and fast-forward local `master` (repo PR pipeline; deploy/none beyond merge without explicit word).

---

## Self-Review

**Spec coverage:** D1 standalone plugin (T1–T7, zero core edits — Global Constraints) ✓; D2 hybrid anonymous (T1 exact behavior 1–3, T2) ✓; D3 all sections (T1 lists/favorites/strips, T2 stats/achievements/genres) ✓; D4 granular display inputs (T1 metadata table, T4 step 1 guards) ✓; D5 title_language default english (T1 table, exact behavior 5) ✓; D6 sort (Global Constraints + card semantics) ✓; D7 limits/shuffle defaults (T1 table) ✓; D8 visual parity (T4 step 3, T3 tokens) ✓; D9 action+web (T1 cases, T5 placeholder, extras gate in T1 metadata) ✓; D10 `.user.login` default (T1 table) ✓; D11 summary/statuses/distribution+activity (T2 exact behavior) ✓; D12 Stitch workflow (T3, T7 step 3) ✓; D13 CSS scope (T4) ✓; D14 people subsets+order (T1 table + exact behavior 3) ✓; D15 earned default/all option (T2 exact behavior 5) ✓; D16 summation + native buckets (T2) ✓; D17 whynothacked (T1 cases, T6 examples, T7 smoke) ✓.

**Step scan:** every step writes one thing or runs one check; bodies pinned only where the spec pins values (query fields, mock branches, display semantics).

**Type consistency:** Result/card shapes single-sourced in the header section; partial and placeholder consume the same keys; `neko-groups.json` referenced identically in T2 and T4 (icons resolve at data layer — partial only renders `icon`/chip data).

**Review Focus (uncovered input classes → pinned tests):**
1. Empty favourites / empty lists for a fresh nickname → section blocks omitted, no crash → add case (g) `plugin_shikimori_user: <nonexistent-nickname-mock-returns-empty>` with empty GET mocks → T1 (extend GET mock branch to return empties when `search=EMPTY`).
2. Missing artwork (`image: null`, `missing_x64.jpg`) → card renders without cover, no imgb64 crash → mock includes a null-image entry in (a) → T1.
3. 429 mid-pagination → single retry then honest error (anilist parity) → unit-follows-anilist; add mocked 429-once branch in POST mock keyed by query name → T1.
4. Light novels inside generic manga lists → ranobe split keeps them out of `manga` lists and inside `ranobe` → case (c) uses mocks where a manga rate has `kind: light_novel` → T1.
5. Display inputs with unknown values (`display_favorites: cover, bogus`) → `bogus` dropped, rest renders → covered by assertion in case (a) inputs (`plugin_shikimori_display_favorites: cover, title, bogus`) → T1.

**Proportion:** plan states contracts and exact values; no code transcripts. Proportional to a ~200-line spec for a multi-file plugin.

---

## Amendments (2026-10-30, post-review evidence)

Supersedes the listed statements below; prepared from primary evidence in `/home/whoami/.opencode/plan/metrics-shikimori-prep/` (task-2-corrected-brief.md, proposed-amendments.md).

### Owner decisions (new, binding)

- **A1 — achievement chip label**: each achievement entry gains an optional `name` — `title_en`, or `title_ru` when `plugin_shikimori_title_language=russian`, falling back to `neko_id`. Task 4/5 read `name ?? neko_id`. (Owner: yes.)
- **A2 — strip display toggles**: add `plugin_shikimori_display_characters` and `plugin_shikimori_display_people`, values `name, artwork`, default `name, artwork` — mirrors `display_favorites`. Task 4 renders per-field and elides artwork fetching when `artwork` is off. (Owner: yes, per D4's "every parameter of every module".)

### Corrections from primary evidence

- **C1/C3 — stats counts**: `stats.statuses`/`stats.full_statuses` are `{anime:[…], manga:[…]}`; each record is `{id, grouped_id, name, size, type}` — the count field is **`size`**. Read `full_statuses` (6 statuses, `rewatching` preserved) and map `size` → output `{name, value}`.
- **C2 — activity**: buckets are native and account-variable (owner ≈13.2 days); map `{name:[from,to],value}` → `{from,to,value}` as-is. Do not assume a fixed ≈178.6-day width.
- **C4/C8/C13 — achievement icons**: drop `neko-groups.json`. Build `neko-icons.json` = `{ [neko_id]: { [level]: "<path>" } }` from **`shikimori/neko-achievements` (MIT)** `priv/rules/*.yml` `metadata.image` (extensions vary: .jpg/.png/.gif). Never construct paths by pattern; unresolvable → `icon: null`. `icon` is resolved via `imports.imgb64(path, {fallback:false})` (data URI, or `null` → chip fallback).
- **C5/C6 — summary sweep**: `userRates.status` is optional, so ONE sweep per target type (2 total), not 12. Page to the true end (short page); safety cap 100 pages/type that **throws a loud error** on exceed — never silently truncate the owner-approved summary.
- **C7 — NEW hard constraint**: GraphQL **max query depth = 5** (a depth-6 query is rejected live). Keep every new document ≤ 5.
- **C10/C11 — Task 2 test gate**: the meaningful TDD gate is the Task 1 harness (`tests/helpers/shikimori.mjs` + `tests/shikimori.test.js`); `tests/cases/shikimori.plugin.yml` stays all-skipped until Task 4 adds the classic partial.

### Controller rulings (bounded alternatives, veto-able)

- Statuses source = `full_statuses`; summary cap = loud error; genres = top-8 by `stats.genres` value desc, empty → omit the row; icon fallback = `null` → chip (a deliberate divergence from AniList's transparent placeholder).

### Task 2 file list (per the corrected brief)

Adds: `source/plugins/shikimori/neko-icons.json` (extracted from the MIT repo with provenance), extensions to `tests/helpers/shikimori.mjs` + `tests/shikimori.test.js`, and the two A2 metadata inputs.

### Superseded statements in this plan

- Task 2 §1 "anime+manga counts summed per status … `{name,value}`" → C1/C3.
- Task 2 §2 pagination caps and "BOTH target types (all 6 statuses …)" → C5/C6.
- Task 2 Interfaces icon pattern and `neko-groups.json` → C4/C8/C13.
- Result contract `icon: resolved URL string or null` → C13.
- Global Constraints → add C7 (depth ≤ 5).
