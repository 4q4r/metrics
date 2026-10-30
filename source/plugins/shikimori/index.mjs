//Setup
export default async function({login, data, queries, imports, q, account}, {enabled = false, extras = false} = {}) {
  //Plugin execution
  try {
    //Check if plugin is enabled and requirements are met
    if ((!q.shikimori) || (!imports.metadata.plugins.shikimori.enabled(enabled, {extras})))
      return null

    //Load inputs
    const {user, medias, sections, statuses, people, sort, "title.language":title_language, score:score_display, limit, "limit.characters":limit_characters, "limit.people":limit_people, shuffle} = imports.metadata.plugins.shikimori.inputs({data, account, q})

    //Initialization
    const result = {user:null, sections, lists:Object.fromEntries(medias.map(media => [media, {}])), favorites:Object.fromEntries(medias.map(media => [media, []])), characters:[], people:{}, stats:{}, achievements:[], genres:[]}

    //User resolution
    console.debug(`metrics/compute/${login}/plugins > shikimori > resolving user ${user}`)
    const found = await request({login, imports, url:`https://shikimori.io/api/users?search=${encodeURIComponent(user)}&limit=1`})
    if ((!Array.isArray(found)) || (!found[0]?.id))
      throw failure(`Could not resolve Shikimori user ${user}`)
    result.user = {id:found[0].id, nickname:found[0].nickname}

    //Medias lists
    if (sections.includes("lists")) {
      for (const media of medias) {
        for (const status of statuses) {
          //Query API (pagination through userRates pages, the API clamps limit to 50 per page, capped at 10 pages)
          const targetType = media === "anime" ? "Anime" : "Manga"
          const rates = []
          let page = 1
          let entries
          do {
            console.debug(`metrics/compute/${login}/plugins > shikimori > querying api (lists ${media} ${status} - page ${page})`)
            const variables = {page, limit:50, userId:result.user.id, targetType, status, order:sort === "updated" ? {field:"updated_at", order:"desc"} : {field:"id", order:"asc"}}
            const query = queries.shikimori.lists({media:media === "anime" ? "anime" : "manga", details:media === "anime" ? "episodes\n      studios { name }" : "chapters\n      volumes"})
            const response = await request({login, imports, url:"https://shikimori.io/api/graphql", body:{query, variables}})
            entries = response.data?.userRates
            if (!Array.isArray(entries))
              throw failure(`Invalid Shikimori ${media} ${status} list response`)
            rates.push(...entries)
            page++
          }
          while ((entries.length === 50) && (page <= 10))
          //Ranobe are the light novel subset of manga rates.
          let list = rates
          if (media === "ranobe")
            list = rates.filter(({manga}) => manga?.kind === "light_novel")
          //Format and save results
          list = list.map(rate => format({media, entity:media === "anime" ? rate.anime : rate.manga, rate, title_language, score_display}))
          result.lists[media][status] = await encode({list:ordering({list, sort, shuffle, limit, imports}), imports})
        }
      }
    }

    //Favorites (v1 API, shared by favorites, characters and people sections)
    let favorites = null
    if ((sections.includes("favorites")) || (sections.includes("characters")) || (sections.includes("people"))) {
      console.debug(`metrics/compute/${login}/plugins > shikimori > querying api (favorites)`)
      favorites = await request({login, imports, url:`https://shikimori.io/api/users/${result.user.id}/favourites`})
      if (!["animes", "mangas", "ranobe", "characters", "people", "seyu", "mangakas", "producers"].every(kind => Array.isArray(favorites?.[kind])))
        throw failure("Invalid Shikimori favorites response")
    }

    //Favorites anime/manga/ranobe
    if (sections.includes("favorites")) {
      for (const media of medias) {
        //Favorites entries in Shikimori website order
        const entries = favorites[{anime:"animes", manga:"mangas", ranobe:"ranobe"}[media]]
        if (!entries.length)
          continue
        //Catalog roots also clamp to 50. Alias ID batches in one POST per media.
        const root = media === "anime" ? "animes" : "mangas"
        const batches = [], variables = {}
        for (let offset = 0; offset < entries.length; offset += 50) {
          const key = `ids${batches.length}`
          variables[key] = entries.slice(offset, offset + 50).map(({id}) => id).join(",")
          batches.push(`media${batches.length}: ${root}(ids: $${key}, limit: 50) { ...FavoriteMedia }`)
        }
        const query = queries.shikimori["favorites-medias"]({variables:Object.keys(variables).map(key => `$${key}: String!`).join(", "), medias:batches.join("\n  "), type:media === "anime" ? "Anime" : "Manga", details:media === "anime" ? "episodes\n  studios { name }" : "chapters\n  volumes"})
        console.debug(`metrics/compute/${login}/plugins > shikimori > querying api (favorites ${media}s - ${entries.length} entries)`)
        const {data:resolved} = await request({login, imports, url:"https://shikimori.io/api/graphql", body:{query, variables}})
        if (!batches.every((_, index) => Array.isArray(resolved?.[`media${index}`])))
          throw failure(`Invalid Shikimori ${media} favorites response`)
        //Format and save results, preserving the favorites response order
        const medias_data = new Map(Object.values(resolved).flat().map(entity => [`${entity.id}`, entity]))
        const list = entries.map(({id, image}) => format({media, id, image, entity:medias_data.get(`${id}`), rate:null, title_language, score_display}))
        result.favorites[media] = await encode({list:ordering({list, sort, shuffle, limit, imports}), imports})
      }
    }

    //Favorites characters
    if (sections.includes("characters"))
      result.characters = await strips({entries:favorites.characters, imports, shuffle:sort === "site" && shuffle, limit:limit_characters})

    //Favorites people (one strip per selected key, in configuration order)
    if (sections.includes("people")) {
      for (const kind of people)
        result.people[kind] = await strips({entries:favorites[kind], imports, shuffle:sort === "site" && shuffle, limit:limit_people})
    }

    //Results
    return result
  }
  //Handle errors
  catch (error) {
    throw imports.format.error(error)
  }
}

/**Media formatter */
function format({media, entity, rate, id, image, title_language, score_display}) {
  if (!entity)
    throw failure(`Could not resolve Shikimori ${media} ${id ?? rate?.id} card`)
  const type = media === "anime" ? "ANIME" : "MANGA"
  const user_score = rate?.score ?? null
  return {
    name:entity[title_language] ?? entity.name,
    type,
    status:entity.status,
    release:entity.airedOn?.year ?? entity.releasedOn?.year ?? null,
    genres:(entity.genres ?? []).map(({name}) => name),
    studio:type === "ANIME" ? entity.studios?.[0]?.name ?? null : null,
    progress:rate ? (media === "anime" ? rate.episodes : rate.chapters) : null,
    volumes:(rate) && (media !== "anime") ? rate.volumes : null,
    description:entity.description?.replace(/<[^>]*>/g, " ") ?? "",
    scores:{
      user:(["user", "both"].includes(score_display)) ? user_score : null,
      community:(["community", "both"].includes(score_display)) ? entity.score ?? null : null,
    },
    released:type === "ANIME" ? entity.episodes ?? null : entity.chapters ?? null,
    artwork:imageUrl(entity.poster?.originalUrl ?? image),
  }
}

/**Encode only the retained cards after sorting, shuffling and limiting */
async function encode({list, imports}) {
  return Promise.all(list.map(async card => ({...card, artwork:await imports.imgb64(card.artwork)})))
}

/**Favorites strip formatter (characters and people) */
async function strips({entries, imports, shuffle, limit}) {
  let selected = shuffle ? imports.shuffle([...entries]) : entries
  if (limit > 0)
    selected = selected.slice(0, limit)
  return Promise.all(selected.map(async ({name, image}) => ({
    name,
    artwork:await imports.imgb64(imageUrl(image)),
  })))
}

/**Ordering helper (sort, shuffle then cut) */
function ordering({list, sort, shuffle, limit, imports}) {
  let ordered = [...list]
  if (sort === "score")
    ordered.sort((a, b) => (b.scores.community ?? b.scores.user ?? -1) - (a.scores.community ?? a.scores.user ?? -1))
  if (sort === "release")
    ordered.sort((a, b) => (b.release ?? -1) - (a.release ?? -1))
  if ((sort === "site") && (shuffle))
    ordered = imports.shuffle(ordered)
  if (limit > 0)
    ordered.splice(limit)
  return ordered
}

/**Canonical absolute artwork URL */
function imageUrl(image) {
  return image ? new URL(image, "https://shikimori.io").href : null
}

/**Preserve actionable messages through the shared error formatter */
function failure(message) {
  return {error:{message, instance:new Error(message)}}
}

/**Anonymous request with rate-limit-only retries */
async function request({login, imports, url, body}) {
  for (;;) {
    try {
      const options = {headers:{"User-Agent":"metrics"}, timeout:30000}
      const {data} = body ? await imports.axios.post(url, body, options) : await imports.axios.get(url, options)
      if (data?.errors?.length)
        throw failure(`Shikimori GraphQL error: ${data.errors.map(({message}) => message).join("; ")}`)
      return data
    }
    catch (error) {
      if ((!error.isAxiosError) || (error.response?.status !== 429))
        throw error
      const retry_after = Number(error.response.headers?.["retry-after"])
      const delay = (Number.isFinite(retry_after) ? Math.max(0, retry_after) : 0) + 5
      console.debug(`metrics/compute/${login}/plugins > shikimori > reached requests limit, retrying in ${delay}s`)
      await imports.wait(delay)
    }
  }
}
