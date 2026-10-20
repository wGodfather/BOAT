// BOAT_INTERACTIVE_BEGIN
// B.O.A.T 1.12: live TMDB metadata and incremental, torrent-only search.
// Appended to the attributed upstream bundle by tools/build-provider.cjs.
(function () {
    const originalMeta = module.exports.getMeta;
    const CONFIG = 'https://raw.githubusercontent.com/wGodfather/BOAT/main/config.json';
    const PROVIDER_TIMEOUT = 5000;
    const TURKISH = /turkish|turkce|türkçe|\btr\b|dublaj/i;
    let configuration;
    const metadataRequests = new Map();
    const image = (path, size = 'w500') => typeof path === 'string' && path.startsWith('/')
        ? `https://image.tmdb.org/t/p/${size}${path}` : null;

    async function requestJSON(url, timeout = PROVIDER_TIMEOUT) {
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

    // TMDB key supplied by the host (BOATFLIX) takes precedence over config.json.
    function hostKey() {
        try {
            const provided = typeof __get_tmdb_api_key === 'function' ? __get_tmdb_api_key() : null;
            if (typeof provided === 'string' && provided) return provided;
        } catch (_) { /* host hook failed; fall through to the global */ }
        const global = globalThis.TMDB_API_KEY;
        return typeof global === 'string' && global ? global : null;
    }

    async function config() {
        if (!configuration) configuration = requestJSON(CONFIG).then(settings => {
            // The host's fetch polyfill resolves broken JSON to null instead of rejecting.
            if (!settings || typeof settings !== 'object') {
                configuration = null;
                throw Error('Invalid configuration body');
            }
            return settings;
        }, error => {
            configuration = null;
            throw error;
        });
        return configuration;
    }

    // config.json is optional: it is only consulted when the host provides no TMDB key,
    // and a failed download never blocks the caller.
    async function settings() {
        if (hostKey()) return null;
        return config().catch(() => null);
    }

    async function tmdb(endpoint, extra = {}) {
        const loaded = await settings();
        const key = hostKey() || loaded?.api_keys?.tmdb;
        if (!key) throw Error('TMDB configuration unavailable');
        const query = { api_key: key, language: loaded?.metadata?.language || 'tr-TR', ...extra };
        const result = await requestJSON('https://api.themoviedb.org/3/' + endpoint + '?' +
            Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'));
        if (!result || typeof result !== 'object') throw Error('Invalid TMDB response');
        return result;
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

    // Resolves the identity once per call and logs a failure once instead of hiding it.
    function resolve(rawId, mediaType, season, episode) {
        return context(rawId, mediaType, season, episode).catch(error => {
            console.warn('BOAT context failed', rawId, error);
            return null;
        });
    }

    function label(stream) {
        return `${stream.title}${stream.size ? ` [${stream.size}]` : ''}${stream.seeders > 0 ? ` [👤 ${stream.seeders}]` : ''}`;
    }

    function torrent(raw, provider) {
        const hash = raw.infoHash || raw.url?.match(/xt=urn:btih:([^&]+)/i)?.[1];
        if (!/^(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(hash || '')) return null;
        const text = `${raw.name || ''}\n${raw.title || ''}`;
        const hints = raw.behaviorHints || {};
        const title = (raw.title || raw.name || provider).split('\n')[0];
        const quality = text.match(/\b(2160p|4k|uhd|1440p|1080p|720p|480p)\b/i)?.[1];
        const size = ce(text) || raw.size;
        const seeders = Number(raw.seeders ?? de(text)) || 0;
        const filename = hints.filename || raw.filename;
        const stream = { name: '', title,
            url: N(hash, title, raw.sources), infoHash: hash.toLowerCase(), type: 'torrent',
            provider, quality, size, seeders, fileIdx: raw.fileIdx ?? raw.fileIndex, filename,
            ...(TURKISH.test(title) ? { language: 'tr' } : {}),
            behaviorHints: { ...hints, filename }, };
        stream.name = label(stream);
        return stream;
    }

    // The same torrent reported by a second provider enriches the first record instead of duplicating it.
    function merge(existing, incoming) {
        if (!existing.provider.split(', ').includes(incoming.provider)) existing.provider += `, ${incoming.provider}`;
        if (incoming.seeders > existing.seeders) {
            existing.seeders = incoming.seeders;
            existing.name = label(existing);
        }
    }

    function withTimeout(promise, ms) {
        let timer;
        const expiry = new Promise(resolve => { timer = setTimeout(() => resolve([]), ms); });
        const clear = () => clearTimeout(timer);
        return Promise.race([promise, expiry]).then(value => { clear(); return value; }, error => { clear(); throw error; });
    }

    function sources(loaded) {
        const urls = loaded?.urls?.boat || {};
        const base = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().replace(/\/+$/, '') : fallback;
        const timeout = Number(loaded?.torrent_search?.providerTimeoutMs);
        return {
            timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : PROVIDER_TIMEOUT,
            providers: [
                ['Torrentio', base(urls.torrentio, qe)],
                ['TorrentsDB', base(urls.torrentsdb, Oe)],
                ['ThePirateBay+', base(urls.tpb, Ne)],
            ],
        };
    }

    async function getStreams(rawId, mediaType, season, episode) {
        const selected = await resolve(rawId, mediaType, season, episode);
        if (!selected) return [];
        const { timeout, providers } = sources(await settings());
        const path = `${selected.series ? 'series' : 'movie'}/${selected.id}${selected.series ? `:${selected.season}:${selected.episode}` : ''}.json`;
        const streams = new Map();
        // OpenSubtitles lookup runs alongside the torrent providers; it never fails or delays the search beyond the provider timeout.
        let subtitles = [];
        const subtitleLookup = withTimeout(
            Promise.resolve().then(() => Ye({ imdbId: selected.id, isSeries: selected.series, season: selected.season, episode: selected.episode })),
            timeout,
        ).then(list => { subtitles = Array.isArray(list) ? list : []; }, () => { subtitles = []; });
        const outcomes = await Promise.allSettled(providers.map(async ([name, base]) => {
            const result = await requestJSON(`${base}/stream/${path}`, timeout);
            if (!result || !Array.isArray(result.streams)) throw Error('Invalid provider response');
            const batch = [];
            for (const raw of result.streams) {
                const stream = torrent(raw, name);
                if (!stream) continue;
                const key = `${stream.infoHash}:${stream.fileIdx ?? 0}`;
                const existing = streams.get(key);
                if (existing) { merge(existing, stream); continue; }
                stream.subtitles = subtitles;
                streams.set(key, stream);
                batch.push(stream);
            }
            // Optional bridge: old Nuvio versions still receive the complete result array.
            if (batch.length && typeof __emit_streams === 'function') __emit_streams(JSON.stringify(batch));
        }));
        outcomes.forEach((outcome, index) => {
            if (outcome.status === 'rejected') console.warn('BOAT provider failed', providers[index][0], outcome.reason);
        });
        await subtitleLookup;
        const all = Array.from(streams.values());
        all.forEach(stream => { stream.subtitles = subtitles; });
        return Rt(all);
    }

    module.exports.getMeta = getMeta;
    module.exports.getStreams = getStreams;
    module.exports.getSubtitles = async (id, type, season, episode) => {
        const c = await resolve(id, type, season, episode);
        return c ? Ye({ imdbId: c.id, isSeries: c.series, season: c.season, episode: c.episode }) : [];
    };
    globalThis.getMeta = getMeta;
    globalThis.getStreams = getStreams;
    globalThis.getSubtitles = module.exports.getSubtitles;
})();
