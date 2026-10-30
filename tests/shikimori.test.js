//Imports
const {spawnSync} = require("child_process")
const path = require("path")

let scenarios
beforeAll(() => {
  const probe = spawnSync("node", ["tests/helpers/shikimori.mjs"], {cwd:path.join(__dirname, ".."), encoding:"utf8", timeout:60000, maxBuffer:16 * 1024 * 1024})
  if (probe.error || probe.status !== 0)
    throw new Error(`${probe.error ?? ""}\n${probe.stderr}\n${probe.stdout}`)
  scenarios = JSON.parse(probe.stdout)
})

describe("Shikimori data layer", () => {
  test("the auto-discovered repository mocks produce all four Task 1 modules", () => {
    const {result, error, calls} = scenarios.repoMocks
    expect(error).toBeUndefined()
    expect(Object.fromEntries(Object.entries(result.favorites).map(([media, cards]) => [media, cards.length]))).toEqual({anime:2, manga:2, ranobe:2})
    expect(result.characters).toHaveLength(22)
    expect(Object.keys(result.people)).toEqual(["seyu", "mangakas"])
    for (const media of ["anime", "manga", "ranobe"])
      for (const status of ["watching", "completed"])
        expect(result.lists[media][status]).toHaveLength(2)
    expect(calls.filter(({body}) => body?.query?.startsWith("query Lists ")).map(({body}) => body.variables.page)).toEqual([1, 1, 1, 1])
  })
  test("defaults resolve the GitHub login and retain the Task 2 result slots", () => {
    const {result, parsed} = scenarios.defaults
    expect(result?.user).toEqual({id:123, nickname:"default-nickname"})
    expect(result?.sections).toEqual(["favorites"])
    expect(Object.keys(result?.favorites ?? {})).toEqual(["anime", "manga"])
    expect(result?.stats).toEqual({})
    expect(result?.achievements).toEqual([])
    expect(result?.genres).toEqual([])
    expect(parsed).toMatchObject({medias:["anime", "manga"], statuses:["watching"], people:["people", "seyu"], "achievements.filter":"earned", sort:"site", "title.language":"english", score:"community", limit:2, "limit.characters":22, "limit.people":22, "limit.achievements":22, shuffle:true})
  })
  test("favorites restore REST order and use the relative image when no poster exists", () => {
    const {result} = scenarios.favoriteOrder
    expect(result?.favorites.anime.map(card => card.name)).toEqual(["Name 3", "English 1", "English 2"])
    expect(result?.favorites.anime[0]).toEqual({name:"Name 3", type:"ANIME", status:"released", release:2020, genres:["Drama", "Adventure"], studio:"Studio", progress:null, volumes:null, description:"First second", scores:{user:null, community:5}, released:12, artwork:"encoded:https://shikimori.io/system/animes/x64/3.jpg"})
    expect(result?.favorites.anime[1].artwork).toBe("encoded:https://shikimori.io/uploads/poster/anime/1.jpg")
  })
  test("more than 50 favorites resolve in one GraphQL request without losing IDs", () => {
    const {result, calls} = scenarios.favoriteLarge
    expect(result?.favorites.anime).toHaveLength(75)
    expect(result?.favorites.anime[0].name).toBe("English 1")
    expect(result?.favorites.anime[74].name).toBe("English 75")
    expect(calls.filter(({method}) => method === "post")).toHaveLength(1)
  })
  test("media limits apply before downloading artwork", () => {
    expect(scenarios.favoriteScore.images).toHaveLength(2)
    expect(scenarios.updated.images).toHaveLength(2)
  })
  test.each([
    ["favoriteScore", ["English 2", "Name 3"]],
    ["favoriteRelease", ["English 1", "Name 3"]],
    ["favoriteUpdated", ["Name 3", "English 1"]],
    ["favoriteShuffle", ["English 2", "English 1"]],
  ])("%s sorts or shuffles before the limit", (name, expected) => {
    expect(scenarios[name].result?.favorites.anime.map(card => card.name)).toEqual(expected)
    expect(scenarios[name].shuffleCalls).toBe(name === "favoriteShuffle" ? 1 : 0)
  })
  test("heavy favorites resolve in batches of at most 100 ids while keeping site order", () => {
    const {result, calls} = scenarios.favoriteHuge
    expect(result?.favorites.anime).toHaveLength(250)
    expect(result?.favorites.anime[0].name).toBe("English 1")
    expect(result?.favorites.anime[249].name).toBe("English 250")
    //250 ids are resolved in three POSTs (100 + 100 + 50), never one oversized alias query.
    const posts = calls.filter(({method}) => method === "post")
    expect(posts).toHaveLength(3)
    expect(posts.flatMap(({body}) => Object.values(body.variables).flatMap(value => `${value}`.split(",")))).toHaveLength(250)
  })
  test("score sorting reads the raw values and ignores the display mask", () => {
    //Favorites have no user score: with score=user the display mask nulls community, so a masked sort would fall back to -1 and keep site order.
    expect(scenarios.favoriteScoreUser.result?.favorites.anime.map(card => card.name)).toEqual(["English 2", "Name 3"])
    expect(scenarios.favoriteScoreUser.result?.favorites.anime[0].scores).toEqual({user:null, community:null})
    //score=off nulls both display scores, but sort=score must still order by the raw community score.
    expect(scenarios.listScoreOff.result?.lists.anime.watching.map(card => card.name)).toEqual(["English 2", "Name 3"])
    expect(scenarios.listScoreOff.result?.lists.anime.watching[0].scores).toEqual({user:null, community:null})
  })
  test("manga and ranobe favorites have no user progress or user score", () => {
    const {result} = scenarios.favoriteManga
    expect(result?.favorites.manga.map(card => card.name)).toEqual(["English 7", "English 8"])
    expect(result?.favorites.ranobe[0]).toMatchObject({name:"English 9", type:"MANGA", progress:null, volumes:null, studio:null, released:40, scores:{user:null, community:8.25}})
  })
  test.each([["russian", "Russian 3"], ["japanese", "Japanese 3"]])("%s selects the requested localized title", (name, title) => {
    expect(scenarios[name].result?.favorites.anime[0].name).toBe(title)
  })
  test("lists select the requested entity even when both nested entities exist", () => {
    const {result} = scenarios.lists
    expect(result?.lists.manga.watching.map(card => card.name)).toEqual(["English 7", "English 8"])
    expect(result?.lists.ranobe.watching.map(card => card.name)).toEqual(["English 9"])
    expect(result?.lists.manga.completed[0]).toMatchObject({type:"MANGA", progress:20, volumes:2, released:40, studio:null})
    expect(result?.lists.anime.watching[0]).toMatchObject({progress:6, volumes:null, released:12, studio:"Studio", scores:{user:7, community:2}})
  })
  test("light novels are excluded from manga lists and appear only in ranobe", () => {
    const {result, calls} = scenarios.lists
    for (const status of ["watching", "completed"]) {
      const manga = result.lists.manga[status].map(card => card.name)
      const ranobe = result.lists.ranobe[status].map(card => card.name)
      //English 9 is the light novel; it must not be reachable through the manga media type.
      expect(manga).not.toContain("English 9")
      expect(ranobe).toEqual(["English 9"])
      expect(manga.filter(name => ranobe.includes(name))).toEqual([])
    }
    //Manga rates are fetched once per status and split into manga/ranobe client-side (no duplicate Manga requests).
    const lists = calls.filter(({body}) => body?.query?.startsWith("query Lists "))
    expect(lists.filter(({body}) => body.variables.targetType === "Manga")).toHaveLength(2)
  })
  test("site-ordered lists fetch only enough pages for the display, while score sorting paginates fully", () => {
    const pages = scenario => scenario.calls.filter(({method}) => method === "post").map(({body}) => body.variables.page)
    //sort=site with a small limit: a single page already satisfies the display.
    expect(pages(scenarios.siteMinimal)).toEqual([1])
    expect(scenarios.siteMinimal.result?.lists.anime.watching).toHaveLength(2)
    //sort=score needs the whole collection before sorting and cutting.
    expect(pages(scenarios.listScore)).toEqual([1, 2])
    expect(scenarios.listScore.result?.lists.anime.watching).toHaveLength(2)
  })
  test("list requests select only the requested nested entity to fit the live complexity limit", () => {
    for (const {body} of scenarios.lists.calls.filter(({method}) => method === "post")) {
      const anime = body.variables.targetType === "Anime"
      expect(body.query).toMatch(anime ? /anime\s*\{/ : /manga\s*\{/)
      expect(body.query).not.toMatch(anime ? /manga\s*\{/ : /anime\s*\{/)
    }
  })
  test("userRates continue at page 2 after a full 50-entry page", () => {
    const {result, calls} = scenarios.pagination
    expect(result?.lists.anime.watching).toHaveLength(53)
    expect(calls.filter(({method}) => method === "post").map(({body}) => body.variables?.page)).toEqual([1, 2])
  })
  test("userRates stop at the ten-page cap", () => {
    const {result, calls} = scenarios.cap
    expect(result?.lists.anime.watching).toHaveLength(500)
    expect(calls.filter(({method}) => method === "post")).toHaveLength(10)
  })
  test("updated lists send the API input-object order and are not shuffled", () => {
    const {calls, shuffleCalls, result} = scenarios.updated
    expect(result?.lists.anime.watching).toHaveLength(2)
    expect(calls.find(({method}) => method === "post").body.variables?.order).toEqual({field:"updated_at", order:"desc"})
    expect(shuffleCalls).toBe(0)
  })
  test.each([["community", {user:null, community:2}], ["user", {user:7, community:null}], ["both", {user:7, community:2}], ["off", {user:null, community:null}]])("%s filters the scores", (mode, scores) => {
    expect(scenarios[`score-${mode}`].result?.lists.anime.watching[0].scores).toEqual(scores)
  })
  test("strips preserve configuration order and cut each strip independently", () => {
    const {result, calls, images} = scenarios.strips
    expect(result?.characters.map(({name}) => name)).toEqual(["Character A"])
    expect(Object.keys(result?.people ?? {})).toEqual(["seyu", "mangakas"])
    expect(result?.people.seyu.map(({name}) => name)).toEqual(["Voice A"])
    expect(result?.people.mangakas.map(({name}) => name)).toEqual(["Author A"])
    expect(calls.filter(({url}) => url.endsWith("/favourites"))).toHaveLength(1)
    expect(images).toHaveLength(3)
    expect(images.every(image => image === "https://shikimori.io/system/people/x64/1.jpg")).toBe(true)
  })
  test("strips shuffle before being cut", () => {
    expect(scenarios.stripsShuffle.result?.characters[0].name).toBe("Character B")
    expect(scenarios.stripsShuffle.result?.people.seyu[0].name).toBe("Voice B")
  })
  test("the non-site sort disables shuffling", () => {
    expect(scenarios.stripsNoShuffle.shuffleCalls).toBe(0)
  })
  test("empty favorites make no catalog requests", () => {
    expect(scenarios.empty.result?.favorites).toEqual({anime:[], manga:[]})
    expect(scenarios.empty.calls.filter(({method}) => method === "post")).toEqual([])
  })
  test("display allowlists drop unknown fields and keep the empty allowlist", () => {
    expect(scenarios.unknown.parsed["display.favorites"]).toEqual(["title", "cover"])
    expect(scenarios.unknown.parsed["display.lists"]).toEqual([])
    expect(scenarios.unknown.result?.sections).toEqual(["favorites"])
  })
  test.each([["missingUser", /missing nickname/], ["missingFavorite", /Shikimori.*3/], ["graphqlError", /Upstream schema failure/], ["malformedFavorites", /Shikimori/]])("%s produces a meaningful formatted error, not empty success", (name, error) => {
    expect(scenarios[name].error?.message).toMatch(error)
    expect(scenarios[name].result).toBeUndefined()
  })
  test("a fuzzy search result for another nickname is rejected instead of being rendered", () => {
    const {error, result, calls} = scenarios.nicknameMismatch
    expect(result).toBeUndefined()
    expect(error?.message).toMatch(/missing nickname/)
    //The nickname mismatch is caught before any other endpoint is queried.
    expect(calls.filter(({url}) => url.endsWith("/favourites"))).toEqual([])
    expect(calls.filter(({method}) => method === "post")).toEqual([])
  })
  test("a non-429 transport failure is not retried", () => {
    expect(scenarios.transportError.error?.message).toMatch(/API error: 500/)
    expect(scenarios.transportError.calls).toHaveLength(1)
    expect(scenarios.transportError.waits).toEqual([])
  })
  test.each([["searchRetry", 7], ["listRetry", 7], ["retryMissingHeader", 5]])("%s retries only the limited request after retry-after plus five seconds", (name, delay) => {
    expect(scenarios[name].error).toBeUndefined()
    expect(scenarios[name].waits).toEqual([delay])
    if (name === "listRetry")
      expect(scenarios[name].result?.lists.anime.watching).toHaveLength(2)
  })
  test("every GET and POST uses the canonical origin and anonymous User-Agent", () => {
    for (const scenario of Object.values(scenarios)) {
      for (const call of scenario.calls) {
        expect(call.url).toMatch(/^https:\/\/shikimori\.io\/api\//)
        expect(call.options.headers).toEqual({"User-Agent":"metrics"})
        if (call.method === "post") expect(call.body.variables).toBeDefined()
      }
    }
  })
  test.each(["disabled", "disabledServer", "disabledExtras"])("%s never calls the API", name => {
    expect(scenarios[name].calls).toEqual([])
    if (name === "disabled") expect(scenarios[name].result).toBeNull()
    else expect(scenarios[name].error?.message).toMatch(/disabled/)
  })
})
