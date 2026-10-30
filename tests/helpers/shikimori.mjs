//Run the real ESM plugin, input parser and query loader below Jest's CommonJS boundary.
//Only network, artwork retrieval, waiting and random shuffling are test doubles.
import setup from "../../source/app/metrics/setup.mjs"
import {formatters} from "../../source/app/metrics/utils.mjs"

async function run() {
  console.debug = () => null
  const {Plugins, conf} = await setup({sandbox:true, log:false})
  const {format} = formatters()

  const entity = (id, type = "anime") => ({
    id:`${id}`,
    name:`Name ${id}`,
    english:id === 3 ? null : `English ${id}`,
    russian:`Russian ${id}`,
    japanese:`Japanese ${id}`,
    kind:id === 9 ? "light_novel" : type === "anime" ? "tv" : "manga",
    status:"released",
    airedOn:{year:{"1":2021, "2":2019, "3":2020}[id] ?? 2022},
    releasedOn:{year:2023},
    score:{"1":2, "2":9, "3":5}[id] ?? 8.25,
    description:"First<br><b>second</b>",
    genres:[{name:"Drama"}, {name:"Adventure"}],
    ...(type === "anime" ? {episodes:12, studios:[{name:"Studio"}]} : {chapters:40, volumes:4}),
    poster:{originalUrl:id === 3 ? null : `https://shikimori.io/uploads/poster/${type}/${id}.jpg`},
  })
  const favorite = id => ({id, name:`Name ${id}`, russian:`Russian ${id}`, image:`/system/animes/x64/${id}.jpg`, url:null})
  const person = name => ({id:1, name, russian:name, image:"/system/people/x64/1.jpg", url:null})
  const favorites = {
    animes:[3, 1, 2].map(favorite),
    mangas:[7, 8].map(favorite),
    ranobe:[9].map(favorite),
    characters:[person("Character A"), person("Character B")],
    people:[person("Person A")],
    seyu:[person("Voice A"), person("Voice B")],
    mangakas:[person("Author A"), person("Author B")],
    producers:[],
  }
  const inputs = overrides => ({shikimori:true, "shikimori.user":"whynothacked", "shikimori.shuffle":"no", ...overrides})
  const scenarios = {
    defaults:{q:{shikimori:true}},
    favoriteOrder:{q:inputs({"shikimori.medias":"anime", "shikimori.limit":0})},
    favoriteLarge:{q:inputs({"shikimori.medias":"anime", "shikimori.limit":0}), large:true},
    favoriteScore:{q:inputs({"shikimori.medias":"anime", "shikimori.sort":"score", "shikimori.shuffle":"yes"})},
    favoriteScoreUser:{q:inputs({"shikimori.medias":"anime", "shikimori.sort":"score", "shikimori.score":"user"})},
    favoriteHuge:{q:inputs({"shikimori.medias":"anime", "shikimori.limit":0}), huge:true},
    listScoreOff:{q:inputs({"shikimori.sections":"lists", "shikimori.medias":"anime", "shikimori.sort":"score", "shikimori.score":"off"})},
    siteMinimal:{q:inputs({"shikimori.sections":"lists", "shikimori.medias":"anime", "shikimori.limit":2}), paginate:true},
    listScore:{q:inputs({"shikimori.sections":"lists", "shikimori.medias":"anime", "shikimori.sort":"score", "shikimori.limit":2}), paginate:true},
    favoriteRelease:{q:inputs({"shikimori.medias":"anime", "shikimori.sort":"release", "shikimori.shuffle":"yes"})},
    favoriteUpdated:{q:inputs({"shikimori.medias":"anime", "shikimori.sort":"updated", "shikimori.shuffle":"yes"})},
    favoriteShuffle:{q:inputs({"shikimori.medias":"anime", "shikimori.shuffle":"yes"})},
    favoriteManga:{q:inputs({"shikimori.medias":"manga, ranobe", "shikimori.score":"both"})},
    russian:{q:inputs({"shikimori.medias":"anime", "shikimori.title.language":"russian"})},
    japanese:{q:inputs({"shikimori.medias":"anime", "shikimori.title.language":"japanese"})},
    lists:{q:inputs({"shikimori.sections":"lists", "shikimori.statuses":"watching, completed", "shikimori.medias":"anime, manga, ranobe", "shikimori.score":"both", "shikimori.limit":0})},
    pagination:{q:inputs({"shikimori.sections":"lists", "shikimori.medias":"anime", "shikimori.limit":0}), paginate:true},
    cap:{q:inputs({"shikimori.sections":"lists", "shikimori.medias":"anime", "shikimori.limit":0}), fullPages:true},
    updated:{q:inputs({"shikimori.sections":"lists", "shikimori.medias":"anime", "shikimori.sort":"updated", "shikimori.shuffle":"yes"})},
    strips:{q:inputs({"shikimori.sections":"characters, people", "shikimori.people":"seyu, mangakas", "shikimori.limit.characters":1, "shikimori.limit.people":1})},
    stripsShuffle:{q:inputs({"shikimori.sections":"characters, people", "shikimori.people":"seyu", "shikimori.limit.characters":1, "shikimori.limit.people":1, "shikimori.shuffle":"yes"})},
    stripsNoShuffle:{q:inputs({"shikimori.sections":"characters, people", "shikimori.people":"seyu", "shikimori.sort":"release", "shikimori.shuffle":"yes"})},
    empty:{q:inputs({"shikimori.sections":"favorites, characters, people"}), empty:true},
    unknown:{q:inputs({"shikimori.sections":"favorites, unknown", "shikimori.display.favorites":"title, unknown, cover", "shikimori.display.lists":""})},
    missingUser:{q:inputs({"shikimori.user":"missing nickname"}), missingUser:true},
    nicknameMismatch:{q:inputs({"shikimori.user":"missing nickname"}), nicknameMismatch:true},
    missingFavorite:{q:inputs({"shikimori.medias":"anime"}), missingFavorite:true},
    graphqlError:{q:inputs({"shikimori.sections":"lists", "shikimori.medias":"anime"}), graphqlError:true},
    malformedFavorites:{q:inputs({"shikimori.medias":"anime"}), malformedFavorites:true},
    transportError:{q:inputs({}), transportError:true},
    searchRetry:{q:inputs({"shikimori.sections":""}), retryGet:true},
    listRetry:{q:inputs({"shikimori.sections":"lists", "shikimori.medias":"anime"}), retryPost:true},
    retryMissingHeader:{q:inputs({"shikimori.sections":""}), retryGet:true, missingHeader:true},
    disabled:{q:{shikimori:false}},
    disabledServer:{q:inputs({}), enabled:false},
    disabledExtras:{q:inputs({}), extras:false},
  }
  for (const score of ["community", "user", "both", "off"])
    scenarios[`score-${score}`] = {q:inputs({"shikimori.sections":"lists", "shikimori.medias":"anime", "shikimori.score":score})}

  const reports = {}
  for (const [name, scenario] of Object.entries(scenarios)) {
    const calls = [], images = [], waits = []
    let shuffleCalls = 0
    let getAttempts = 0, postAttempts = 0
    const error = status => Object.assign(new Error(`HTTP ${status}`), {isAxiosError:true, response:{status, headers:scenario.missingHeader ? {} : {"retry-after":"2"}, data:{message:"Transport failure"}}})
    const imports = {
      metadata:conf.metadata,
      format,
      shuffle(list) {
        shuffleCalls++
        return [...list].reverse()
      },
      async wait(seconds) {
        waits.push(Number.isFinite(seconds) ? seconds : "non-finite")
      },
      async imgb64(image) {
        images.push(image)
        return image ? `encoded:${image}` : null
      },
      axios:{
        async get(url, options) {
          calls.push({method:"get", url, options})
          if (scenario.transportError) throw error(500)
          if (scenario.retryGet && !getAttempts++) throw error(429)
          if (url.includes("?search="))
            return {data:scenario.missingUser ? [] : scenario.nicknameMismatch ? [{id:999, nickname:"a different account"}] : [{id:123, nickname:decodeURIComponent(url.match(/search=([^&]*)/)[1])}]}
          if (!url.endsWith("/favourites")) throw new Error(`Unexpected fixture request: ${url}`)
          if (scenario.malformedFavorites) return {data:{}}
          return {data:scenario.empty ? Object.fromEntries(Object.keys(favorites).map(key => [key, []])) : {...favorites, ...(scenario.large ? {animes:Array.from({length:75}, (_, index) => favorite(index + 1))} : {}), ...(scenario.huge ? {animes:Array.from({length:250}, (_, index) => favorite(index + 1))} : {})}}
        },
        async post(url, body, options) {
          calls.push({method:"post", url, body, options})
          if (scenario.retryPost && !postAttempts++) throw error(429)
          if (scenario.graphqlError) return {data:{data:null, errors:[{message:"Upstream schema failure"}]}}
          const {query, variables} = body
          if (query.startsWith("query Lists ")) {
            const {targetType, page, status} = variables
            const ids = scenario.paginate || scenario.fullPages ? Array.from({length:scenario.fullPages || page === 1 ? 50 : 3}, (_, index) => 100 + (page - 1) * 50 + index) : targetType === "Anime" ? [1, 2, 3] : [7, 8, 9]
            const rates = ids.map(id => ({id:`${1000 + id}`, score:7, status, episodes:targetType === "Anime" ? 6 : 0, chapters:targetType === "Manga" ? 20 : 0, volumes:targetType === "Manga" ? 2 : 0, anime:entity(id), manga:entity(id, "manga")}))
            return {data:{data:{userRates:rates}}}
          }
          if (!query.startsWith("query FavoritesMedias ")) throw new Error("Unexpected fixture GraphQL query")
          const data = {}
          //Mirror the live catalog's 50-entry clamp and non-favorites ordering.
          for (const [, alias, root, variable] of query.matchAll(/(\w+): (animes|mangas)\(ids: \$(\w+), limit: 50\)/g)) {
            const ids = `${variables[variable]}`.split(",").map(Number)
            data[alias] = scenario.missingFavorite ? [] : ids.slice(0, 50).reverse().map(id => entity(id, root === "animes" ? "anime" : "manga"))
          }
          if (!Object.keys(data).length)
            throw new Error("Unexpected favorites batch query")
          return {data:{data}}
        },
      },
    }
    const data = {user:{login:"default-nickname"}}
    const parsed = conf.metadata.plugins.shikimori.inputs({q:scenario.q, data, account:"user"})
    try {
      const result = await Plugins.shikimori({login:"test", data, q:scenario.q, queries:conf.queries, imports, account:"user"}, {enabled:scenario.enabled ?? true, extras:scenario.extras ?? true})
      reports[name] = {result, calls, images, waits, shuffleCalls, parsed}
    }
    catch (error) {
      reports[name] = {error:{message:error.error?.message, cause:error.error?.instance?.message}, calls, images, waits, shuffleCalls, parsed}
    }
  }
  //Integration with the repository's auto-discovered axios mocks (no live API).
  const {default:mocks} = await import("../mocks/index.mjs")
  const utils = await import("../../source/app/metrics/utils.mjs")
  await mocks({graphql:() => {
    throw new Error("Unexpected GitHub fixture request")
  }, rest:{}})
  const calls = []
  try {
    const q = inputs({"shikimori.sections":"favorites, lists, characters, people", "shikimori.medias":"anime, manga, ranobe", "shikimori.statuses":"watching, completed", "shikimori.people":"seyu, mangakas"})
    const result = await Plugins.shikimori({login:"test", data:{user:{login:"default-nickname"}}, q, account:"user", queries:conf.queries, imports:{...utils, metadata:conf.metadata, format, axios:{
      get(url, options) {
        calls.push({method:"get", url, options})
        return utils.axios.get(url, options)
      },
      post(url, body, options) {
        calls.push({method:"post", url, body, options})
        return utils.axios.post(url, body, options)
      },
    }}}, {enabled:true, extras:true})
    reports.repoMocks = {result, calls}
  }
  catch (error) {
    reports.repoMocks = {error:{message:error.error?.message, cause:error.error?.instance?.message}, calls}
  }
  return reports
}

run().then(reports => process.stdout.write(JSON.stringify(reports))).catch(error => {
  console.error(error)
  process.exitCode = 1
})
