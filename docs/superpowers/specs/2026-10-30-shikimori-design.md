# Shikimori plugin for metrics — design document

Date: 2026-10-30
Status: awaiting owner approval (post builder-check)
Author: controller session (GLM-5.3-Flash orchestrator), decisions from owner interview (3 grilling rounds)

## 1. Intent and why

The repository is a fork of [lowlighter/metrics v3.35.0-beta] — a GitHub Action + web instance that
renders GitHub profile metrics from self-contained plugins. An AniList plugin already exists
(`source/plugins/anilist` + `source/templates/classic/partials/anilist.ejs`). The owner wants a
**Shikimori** (shikimori.one, Russian anime/manga database) integration that reuses the same visual
language as the AniList cards but is **fully configurable**: nearly every parameter of every
displayed module can be toggled individually, mirroring the granularity of the Shikimori API itself.

## 2. Owner decisions (binding)

| # | Decision |
|---|----------|
| D1 | Standalone self-contained plugin `shikimori` (like anilist). Zero core changes; anilist plugin untouched. A music-plugin-style provider selector refactor is explicitly NOT part of this work. |
| D2 | Hybrid API, anonymous only: GraphQL as primary (user lists + card data, richer query params, new-format posters), Shikimori REST v1 point-wise for sections the public GraphQL schema does not expose (favourites, achievements, user statistics). No OAuth. |
| D3 | Sections, full scope from day one: `favorites` (anime/manga/ranobe), `characters` strip, `people` strip (separate limits), `lists` (user lists filtered by status), `stats` (summary line + status chips + score-distribution/activity mini-block), `achievements` (icon strip AND text chips, selectable), `genres` line. |
| D4 | Granular display configuration: no layout presets. One display input per module; every card parameter (cover, title, description, score, progress, year+status, genres, studio, type, …) individually toggleable. Compactness emerges naturally (disable `cover` → compact row). |
| D5 | Title language configurable (`english|russian|japanese`), **default `english`** (owner decision Q16б — "defaults like AniList"). |
| D6 | Sort: `site|score|release|updated`, default `site`. API-level ordering only supports `id|updated_at`; `score`/`release` sorting is client-side (fetch more than limit, sort, cut). |
| D7 | Limits and shuffle configurable with AniList defaults: `limit` 2, character-people-achievements strip limits 22 (separate per strip), `shuffle` yes. |
| D8 | Visual: 1-to-1 AniList card visual language (same grid classes, cover sizes, infos layout). |
| D9 | Targets both GitHub Action and web instance: full repo touchpoint checklist incl. placeholder mocks and the `extras` gate (`metrics.run.puppeteer.scrapping`) like anilist. |
| D10 | `user` input defaults to `.user.login` (owner's Shikimori nickname matches GitHub login). |
| D11 | Stats block content: summary line ("N episodes watched / M chapters read" — sums from `full_statuses`, exact fields verified during implementation) + status chips (`watching: 12, completed: 340, …`) + a separate mini-block for score distribution and weekly activity. |
| D12 | NEW GRAPHICAL ELEMENTS WORKFLOW (owner mandate, binding for implementation): every new graphical element (achievement badges, status chips, distribution/activity mini-block) is designed by a UI-designer subagent via **Stitch**: it passes the currently implemented styles/formats/sizes plus a full description of what exists and what to build; Stitch produces mockups; mockups are checked for harmonious match with the implemented design (Vision MCP); if OK they are adopted; after implementation a subagent verifies the rendered result against the mockup via `ui_diff_check` — deviations trigger a fix round. |
| D13 | Template CSS: a `.shikimori`-scoped style block in `source/templates/classic/style.css` mirroring the `.anilist` scope is **allowed** (owner: standard plugin touchpoint, not core). |
| D14 | People strips: owner selects any subset of `people, seyu, mangakas, producers` (one, several, or all); each selected key gets its own strip; **strip order follows the config order** (first key = top strip). Separate limit per strip. |
| D15 | Achievements filter: **earned only (`level >= 1`) is the default**; "all with progress" is a configurable option. |
| D16 | Summary line: client-side summation of `episodes`/`chapters` across **all** `userRates` pages (both target types), fetched only when the stats summary is enabled. Activity mini-block renders **native ≈178.6-day buckets** as-is. |
| D17 | Owner's Shikimori nickname: `whynothacked` (used for the examples workflow and live smoke; the `.user.login` default mechanism stays). |

## 3. Goals / non-goals / anti-goals

Goals
- A `plugin_shikimori` that renders, for any public Shikimori nickname, the sections above in the classic template, fully configured by action inputs.
- Works in GitHub Action runs and in the web instance (placeholder mocks).
- Repo-conventional tests, mocks, examples, docs regeneration.

Non-goals
- No OAuth / no writes (user_rates mutations, favourites reordering, etc.).
- No catalog browsing sections (animes/mangas catalog search is out of scope; only user-centric data).
- No refactor of anilist or shared provider abstraction.
- No clubs favourites (the favourites API does not expose clubs).
- No score-distribution/activity rendering beyond the agreed mini-block.

Anti-goals (fail loudly)
- No silently-empty sections on API failure: follow the anilist error path (`imports.format.error` → partial renders the error block).
- No slang anywhere in code/strings/docs ("Shikimori", never "shiki").
- No mock fallbacks in production paths; mocks live only in tests and the web placeholder.

## 4. Verified API facts (live probes, 2026-10-30)

Base: **`https://shikimori.io`** — canonical (builder-check 2026-10-30: `shikimori.one` 301s every GET and 308s every POST to `.io`; prior fact: `.one` is RU-blocked for direct access; earlier `.one` probes in this doc followed redirects silently). Requirements: HTTPS only; **`User-Agent` header mandatory** (application name, e.g. `metrics`) — currently not hard-enforced upstream (200 with empty/generic UA observed) but documented mandatory: send explicit `User-Agent: metrics` per request; limits **5 rps / 90 rpm** — implement the anilist-style retry pattern for limit responses (429 body shape: verify during implementation).

### 4.1 GraphQL (`POST /api/graphql`, anonymous reads verified)

Query roots: `animes, mangas, characters, people, genres, contests, users, userRates, currentUser`.

- `userRates(page=1, limit=2, userId, targetType, status, order)` → `UserRate { id, score, status, episodes, chapters, volumes, rewatches, text, createdAt, updatedAt, anime, manga }`
  - `targetType` values are **PascalCase** (`Anime`, `Manga`)
  - `UserRateStatusEnum`: `planned, watching, rewatching, completed, on_hold, dropped` (lowercase)
  - `order` is an **input object** (`{field: id|updated_at, order: asc|desc}`, `order` required), not the flat enum; catalog roots use a different `OrderEnum`
  - **`limit` silently clamps to 50/page** (verified: 100 and 500 both return 50)
  - `UserRate.anime` / `.manga`: exactly one is non-null, matching `targetType`
- `Anime` fields (public schema): `id, name, russian, english, japanese, synonyms, kind, rating, status, season, airedOn, releasedOn, episodes, episodesAired, duration, score, scoresStats, statusesStats, genres, studios, fansubbers, fandubbers, poster, screenshots, description, descriptionHtml, franchise, chronology, related, externalLinks, malId, isCensored, …` (new-format posters ONLY via GraphQL).
- `Manga` mirrors Anime (`publisher` instead of studios; `kind` includes light novels).
- `User` (public): `avatarUrl, id, lastOnlineAt, nickname, url` — **no favourites/stats/achievements in the public GraphQL schema** (hence the hybrid in D2).
- Ranobe: represented as `Manga` with light-novel kind; client-side kind filter per D2/D3.

### 4.2 REST v1 (anonymous verified; v1 is marked "outdated" upstream but is the only public source for these sections)

- `GET /api/users/:id/favourites` → object keyed by type; **verified key set**: `animes, mangas, ranobe, characters, people, mangakas, seyu, producers`; entries `{ id, name, russian, image, url: null }`.
  - `image` is a **relative path** (`/system/<type>/x64/<id>.jpg?<ts>`; ranobe images live under `/system/mangas/`; missing entries = `/assets/globals/missing_x64.jpg`) — host-prefix before `imports.imgb64`, which fetches only absolute http(s) URLs and sends no `User-Agent`.
- `GET /api/achievements?user_id=N` → `[ { neko_id, level, progress, … } ]` — returns **all ~135 entries per user** including unearned `level: 0, progress < 100`; a display filter is an owner decision (see addendum). Icon URL pattern verified: `/assets/achievements/<group>/<neko_id>_<level>.jpg` (+ `<group>/franchise/<neko_id>.png` exception); the **group component is absent from the API response** → static neko_id→group map (from Shikimori's open-source repo) or candidate probing; text chips remain the fallback.
- `GET /api/users/:id` → profile incl. `stats` histogram object (keys verified: `statuses, full_statuses, scores, types, ratings, genres, studios, publishers, activity`).
  - `full_statuses` = per-status `{ name, size, type }` where `size` is a **title count** — there are **no episodes/chapters totals anywhere in the profile stats** (summary-line semantics are an owner decision, see addendum).
  - `scores` = `{ anime: [{ name: "10", value }, …], manga: […] }` — distribution ready as-is.
  - `activity` buckets are ≈**178.6-day spans** (`[{ name: [ts_from, ts_to], value }]`), not weekly — activity rendering semantics are an owner decision (see addendum).
  - `types` / `ratings` names arrive **localized Russian**.
- Resolve nickname → id via `GET /api/users?search=<nick>&limit=1` (exact nicknames resolve exact-first; `users(search:)` GraphQL mirrors it).

Builder must live-verify the uncertain items above (favourites key set, ranobe/people/seyu entry shape, achievement icon URL pattern, nickname resolution path) and encode verified shapes into mocks.

## 5. Configuration surface (proposed; exact YAML naming = builder/plan domain, follows `plugin_anilist_*` conventions)

- `plugin_shikimori` (boolean, default no, extras gate `metrics.run.puppeteer.scrapping`)
- `plugin_shikimori_user` (string, default `.user.login`)
- `plugin_shikimori_medias` (comma-separated: `anime, manga, ranobe`; default `anime, manga`)
- `plugin_shikimori_sections` (comma-separated: `favorites, characters, people, lists, stats, achievements, genres`; default `favorites`)
- `plugin_shikimori_people` (comma-separated, order-significant: any subset of `people, seyu, mangakas, producers`; default `people, seyu`) — one strip per selected key, **config order = display order (first = top)**
- `plugin_shikimori_achievements_filter` (`earned|all`, default `earned`)
- `plugin_shikimori_statuses` (comma-separated, values = the 6 status enum values; default `watching`)
- `plugin_shikimori_sort` (`site|score|release|updated`, default `site`)
- `plugin_shikimori_title_language` (`english|russian|japanese`, default `english`)
- `plugin_shikimori_score` (`community|user|both|off`, default `community`; user score only exists for list entries, not favourites)
- `plugin_shikimori_limit` (number, default 2), `plugin_shikimori_limit_characters` (22), `plugin_shikimori_limit_people` (22), `plugin_shikimori_limit_achievements` (22)
- `plugin_shikimori_shuffle` (boolean, default yes)
- Per-module display inputs (comma-separated field lists; presence = shown, absent = hidden; AniList-consistent field names):
  - `plugin_shikimori_display_favorites` / `plugin_shikimori_display_lists` over: `cover, title, description, score, user_score, progress, year, status, genres, studio, type`
  - `plugin_shikimori_display_stats` over: `summary, statuses, distribution, activity`
  - `plugin_shikimori_display_achievements` over: `icons, chips`
- Ranobe handling: lists section gets ranobe rows from `targetType: Manga` rates filtered client-side by light-novel kind; favourites section uses the v1 `ranobe` key.

## 6. Data flow

1. Resolve `user` → id (GraphQL `users(search:)` or v1 search; builder picks and verifies one, mock encodes it).
2. GraphQL `userRates(...)` per selected `targetType` + `status` (+ pagination as needed) → card objects (format like anilist `format()`: name by `title_language`, score(s), progress = episodes/chapters/volumes, released totals, year+status, genres, studio, type, description, artwork via `imports.imgb64`).
3. v1 favourites → favourites card objects (no user score/progress) per selected media + characters + people.
4. v1 profile stats → status chips, score distribution + native-bucket activity mini-block data; the summary line ("N episodes watched / M chapters read") is computed by client-side summation across **all** `userRates` pages (both target types, paginated at 50/page) and fetched only when the stats summary field is enabled.
5. v1 achievements → badge list (neko_id → icon URL resolved per builder verification; text chips fallback data always computed).
6. Client-side sorting (`score|release|updated`) then cut to limits; shuffle applied last (AniList semantics).
7. Render via `source/templates/classic/partials/shikimori.ejs`, registered in the template partial index; sections honor `config_display`/`config_order` core vocabulary.

## 7. Rendering and visual contract

- Card grid, cover sizes (48×72), infos rows, character strip (36×54): identical to `anilist.ejs` vocabulary (`.medias.largeable-flex-wrap`, `.media.largeable-width-half`, `.about`, `.infos`, `.description`).
- New elements (achievement badge strip, status chips, distribution/activity mini-block) follow the Stitch workflow in D12. The UI-designer subagent receives: classic template CSS, anilist partial markup, exact sizes/typography/colors of implemented elements, and the data model per section; mockups must read as native extensions of the existing design.
- English labels for section headers (repo convention), e.g. "Favorites animes", "Currently watching", "Achievements".

## 8. Repo touchpoint checklist (all nine, zero core changes)

1. `source/plugins/shikimori/` — `index.mjs`, `metadata.yml`, `queries/*.graphql` (repo convention: documents with `$var` interpolation are auto-loaded; the earlier "queries.mjs" was a naming slip).
2. `tests/cases/shikimori.plugin.yml` — test cases in repo harness.
3. `tests/mocks/api/axios/post/shikimori.mjs` (+ any GET mocks needed for v1) — axios mocks.
4. `source/templates/classic/partials/shikimori.ejs` + registration in the template partials index (`partials/_.json`).
5. `settings.example.json` — example settings entry.
6. `.github/workflows/examples.yml` — example job producing an example SVG.
7. `.github/config/label.yml` — plugin label.
8. `source/app/web/statics/embed/app.placeholder.js` — hardcoded placeholder mocks for the web instance (jest-tested file).
9. `source/templates/classic/style.css` — a `.shikimori`-scoped style block mirroring the `.anilist` scope (card styles are **scoped per plugin** in this template — `.anilist .media`, `.steam .media` — there is no generic `.medias` rule, so a `shikimori` partial reusing the same class names renders unstyled without this). Plus plugin-level `examples.yml` like anilist. **Owner-approved** (D13).
10. `npm run build -- publish` regenerates `action.yml` + README plugin indexes.

Web instance gating: same `extras: metrics.run.puppeteer.scrapping` semantics as anilist (metadata.yml `extras`).

## 9. Verification plan

- Repo quality gates: lint, jest suite (incl. new cases + placeholder tests), `npm run build -- publish` diff clean.
- Live smoke against shikimori.one for a real nickname (owner's), read-only GETs/GraphQL queries only.
- Visual: rendered SVG inspected via Vision MCP; implementation vs Stitch mockups via `ui_diff_check` (D12). Any deviation = fix round.
- Branch → PR → CodeRabbit + reviewer subagent → address findings → squash-merge (repo pipeline).

## 10. Constraints

- Node 20 ESM, repo code style; no new runtime dependencies (axios/imgb64/EJS infrastructure already in core).
- Rate limits 5 rps / 90 rpm; retry on limit responses (anilist 429 pattern adapted — verify Shikimori's limit response shape during implementation).
- Distroless-friendly: no shell-outs, no new binaries.
- English in code/comments/user-visible strings; no slang.
- Anonymous traffic only — no secrets, no tokens in examples or workflows.

## 11. Left to the builder (not owner decisions)

- Exact YAML input names/defaults micro-polish within §5.
- Achievement neko_id→group map sourcing (static table extracted from Shikimori's open-source repo vs candidate probing; display filter decided — D15).
- Retry/limit-response shape adaptation (429 body — deliberately not triggered during checks).
- Pagination depth policy per section (bounded, seeded by limits; hard API cap 50/page).
- Mock fixtures content for all verified shapes.

## 12. Builder-check addendum (2026-10-30)

Builder-check questions answered without the owner (marked as controller calls, veto-able):

- **Base domain** = `shikimori.io` (D2/§4 corrected; `.one` is a 301/308 redirector, RU-blocked directly).
- **Score rendering**: Shikimori scores are 10-point decimals (`8.24`) — rendered as-is, **no AniList-style `%`** (a percent of a 10-point scale is meaningless).
- **Repo conventions confirmed**: per-plugin CSS scoping (see §8.9), `queries/*.graphql` auto-load, axios mocks auto-load from `tests/mocks/api/axios/{get,post}/*.mjs`, `imports.imgb64` absolute-URL-only/no-UA (§4.2), favourites images relative (§4.2), pagination clamps at 50/page (§4.1).

Questions only the owner can answer — **all answered 2026-10-30** (see D13–D17): template CSS allowed; summary = client-side summation (а); activity = native buckets (а); people = per-key strips, config-ordered subsets of `people/seyu/mangakas/producers`; achievements = earned-only default + `all` option; nickname = `whynothacked`.
