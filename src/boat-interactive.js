// BOAT_INTERACTIVE_BEGIN
// B.O.A.T 1.11: live TMDB metadata and incremental, torrent-only search.
// Appended to the attributed upstream bundle by tools/build-provider.cjs.
(function () {
    const originalMeta = module.exports.getMeta;
    const CONFIG = 'https://raw.githubusercontent.com/wGodfather/BOAT/main/config.json';
    let configuration;
    const metadataRequests = new Map();
    const image = (path, size = 'w500') => typeof path === 'string' && path.startsWith('/')
        ? `https://image.tmdb.org/t/p/${size}${path}` : null;

    async function requestJSON(url, timeout = 5000) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timer;
        try {
            return await Promise.race([
                (async () => {
                    const response = await fetch(url, { headers: C, ...(controller ? { signal: controller.signal } : {}) });
                    if (!response.ok) throw Error(`HTTP ${response.status}`);
                    return response.json();
                })(),
                new Promise((_, reject) => { timer = setTimeout(() => {
                    if (controller) controller.abort();
                    reject(Error('Provider timeout'));
                }, timeout); }),
            ]);
        } finally { if (timer) clearTimeout(timer); }
    }

    async function config() {
        if (!configuration) configuration = requestJSON(CONFIG).catch(error => {
            configuration = null;
            throw error;
        });
        return configuration;
    }

    async function tmdb(endpoint, extra = {}) {
        const settings = await config();
        const override = typeof __get_tmdb_api_key === 'function' ? __get_tmdb_api_key() : null;
        const key = override || settings.api_keys?.tmdb;
        if (!key) throw Error('TMDB configuration unavailable');
        const query = { api_key: key, language: settings.metadata?.language || 'tr-TR', ...extra };
        return requestJSON('https://api.themoviedb.org/3/' + endpoint + '?' +
            Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'));
    }

    function person(p, role) {
        return { name: p.name, tmdbId: p.id, photo: image(p.profile_path, 'w185'),
            role: role || p.character || p.roles?.[0]?.character || null };
    }

    function logo(images, language) {
        const rank = p => p.iso_639_1 === language.substring(0, 2) ? 0 : p.iso_639_1 === 'en' ? 1 : !p.iso_639_1 ? 2 : 3;
        const logos = (images?.logos || []).filter(p => image(p.file_path));
        logos.sort((a, b) => rank(a) - rank(b) || (b.vote_average || 0) - (a.vote_average || 0));
        return image(logos[0]?.file_path);
    }

    async function getMeta(input) {
        const cacheKey = typeof input === 'string' ? input : `${input.type}:${input.id}`;
        const cached = metadataRequests.get(cacheKey);
        if (cached && Date.now() - cached.at < 300000) return cached.value;
        const value = (async () => {
            const base = await originalMeta(input);
            const meta = base?.meta;
            if (!meta) return base;
            try {
                const media = meta.type === 'movie' ? 'movie' : 'tv';
                const id = meta.tmdbId || String(meta.id).match(/(?:boat:(?:movie|series):|tmdb:)(\d+)/)?.[1];
                if (!id || !/^\d+$/.test(String(id))) return base;
                const details = await tmdb(`${media}/${id}`, {
                    append_to_response: media === 'tv' ? 'credits,aggregate_credits,images,external_ids' : 'credits,images,external_ids',
                    include_image_language: 'tr,en,null',
                });
                const credits = details.aggregate_credits || details.credits || {};
                const crew = (credits.crew || []).flatMap(p => {
                    const jobs = p.jobs?.map(j => j.job) || [p.job];
                    const role = jobs.find(j => ['Director', 'Writer', 'Screenplay'].includes(j));
                    return role ? [person(p, role === 'Screenplay' ? 'Writer' : role)] : [];
                }).concat((details.created_by || []).map(p => person(p, 'Creator')));
                const posters = Object.fromEntries((details.seasons || []).filter(s => image(s.poster_path))
                    .map(s => [s.season_number, image(s.poster_path)]));
                return { ...base, meta: { ...meta,
                    imdb_id: details.external_ids?.imdb_id || meta.imdbId,
                    logo: logo(details.images, 'tr-TR') || meta.logo,
                    cast: (credits.cast || []).map(p => p.name),
                    seasonPosters: posters,
                    app_extras: { ...meta.app_extras, cast: (credits.cast || []).map(p => person(p)), directors: crew, seasonPosters: posters },
                    videos: (meta.videos || []).map(v => ({ ...v, seasonPoster: posters[v.season] || v.seasonPoster })),
                } };
            } catch (_) { return base; }
        })();
        metadataRequests.set(cacheKey, { at: Date.now(), value });
        if (metadataRequests.size > 64) metadataRequests.delete(metadataRequests.keys().next().value);
        try { return await value; } catch (error) { metadataRequests.delete(cacheKey); throw error; }
    }

    async function context(rawId, mediaType, season, episode) {
        const series = ['series', 'tv', 'anime'].includes(mediaType);
        const raw = String(rawId).replace(/^(?:boat|noat):(?:movie|series|ep):/, '');
        const identity = raw.replace(/^tmdb:/, "").match(/^(tt\d+|\d+)(?::(\d+):(\d+))?$/);
        const s = season ?? (identity?.[2] ? Number(identity[2]) : 1);
        const e = episode ?? (identity?.[3] ? Number(identity[3]) : 1);
        let id = identity?.[1]?.startsWith("tt") ? identity[1] : null;
        if (!id) {
            const numeric = raw.replace(/^tmdb:/, '').split(':')[0];
            if (!/^\d+$/.test(numeric)) return null;
            id = (await tmdb(`${series ? 'tv' : 'movie'}/${numeric}/external_ids`)).imdb_id;
        }
        if (!/^tt\d+$/.test(id || '')) return null;
        if (series && (!Number.isInteger(s) || s < 0 || !Number.isInteger(e) || e < 1)) return null;
        return { id, series, season: s, episode: e };
    }

    function torrent(raw, provider) {
        const hash = raw.infoHash || raw.url?.match(/xt=urn:btih:([^&]+)/i)?.[1];
        if (!/^(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(hash || '')) return null;
        const text = `${raw.name || ''}\n${raw.title || ''}`;
        const hints = raw.behaviorHints || {};
        const title = (raw.title || raw.name || provider).split('\n')[0];
        const quality = text.match(/\b(2160p|4k|uhd|1440p|1080p|720p|480p)\b/i)?.[1];
        const size = ce(text) || raw.size;
        const seeders = raw.seeders ?? de(text);
        const filename = hints.filename || raw.filename;
        return { name: `${title}${size ? ` [${size}]` : ''} [👤 ${seeders}]`, title,
            url: N(hash, title, raw.sources), infoHash: hash.toLowerCase(), type: 'torrent',
            provider, quality, size, seeders, fileIdx: raw.fileIdx ?? raw.fileIndex, filename,
            behaviorHints: { ...hints, filename }, };
    }

    async function getStreams(rawId, mediaType, season, episode) {
        const selected = await context(rawId, mediaType, season, episode).catch(() => null);
        if (!selected) return [];
        const path = `${selected.series ? 'series' : 'movie'}/${selected.id}${selected.series ? `:${selected.season}:${selected.episode}` : ''}.json`;
        const seen = new Set();
        const all = [];
        const providers = [['Torrentio', qe], ['TorrentsDB', Oe], ['ThePirateBay+', Ne]];
        await Promise.allSettled(providers.map(async ([name, base]) => {
            const result = await requestJSON(`${base}/stream/${path}`);
            const batch = (result.streams || []).map(raw => torrent(raw, name)).filter(Boolean).filter(stream => {
                const key = `${stream.infoHash}:${stream.fileIdx ?? ''}:${stream.filename || ''}`;
                if (seen.has(key)) return false;
                seen.add(key); return true;
            });
            all.push(...batch);
            // Optional bridge: old Nuvio versions still receive the complete result array.
            if (batch.length && typeof __emit_streams === 'function') __emit_streams(JSON.stringify(batch));
        }));
        return Rt(all);
    }

    module.exports.getMeta = getMeta;
    module.exports.getStreams = getStreams;
    module.exports.getSubtitles = async (id, type, season, episode) => {
        const c = await context(id, type, season, episode).catch(() => null);
        return c ? Ye({ imdbId: c.id, isSeries: c.series, season: c.season, episode: c.episode }) : [];
    };
    globalThis.getMeta = getMeta;
    globalThis.getStreams = getStreams;
    globalThis.getSubtitles = module.exports.getSubtitles;
})();
