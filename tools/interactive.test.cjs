const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const bundle = fs.readFileSync(path.join(__dirname, '../providers/boat.js'), 'utf8');
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const DEFAULT_CONFIG = {api_keys:{tmdb:'test-key'},metadata:{language:'tr-TR'}};
// options.config: config.json body, or a function returning one per request; options.globals: extra host globals.
function runtime(fetcher, emit = () => {}, options = {}) {
    const calls = [], warnings = [];
    const logger = Object.assign(Object.create(console), {warn: (...args) => warnings.push(args)});
    const sandbox = {module:{exports:{}}, console:logger, URL, URLSearchParams, TextEncoder, TextDecoder,
        setTimeout, clearTimeout, AbortController, atob, btoa, __emit_streams:emit,
        require: name => name === "cheerio" ? {} : null,
        fetch: async (url, requestOptions) => {
            calls.push(String(url));
            if (String(url).endsWith('/config.json')) {
                const body = typeof options.config === 'function' ? options.config() : (options.config || DEFAULT_CONFIG);
                return {ok:true,status:200,json:async()=>body};
            }
            return fetcher(String(url), requestOptions || {});
        }, ...(options.globals || {})};
    vm.createContext(sandbox); vm.runInContext(bundle,sandbox);
    return {api:sandbox.module.exports,calls,warnings};
}
const response = data => ({ok:true,status:200,json:async()=>data});
const stream = (hash=A,index=8) => ({infoHash:hash,fileIdx:index,
    name:'Torrentio 1080p',title:'Suits.S02E09.mkv\n👤 22 💾 2.5 GB',
    behaviorHints:{filename:'Suits.S02E09.mkv',videoSize:2500000000}});

test('three providers start together, fast results arrive before the slow provider',async()=>{
    let release; const slow = new Promise(resolve=>{release=resolve;});
    const batches=[];
    const r=runtime(async url=>{
        if(url.includes('torrentio'))return response({streams:[stream()]});
        if(url.includes('torrentsdb'))return response({streams:[stream(B)]});
        await slow; return response({streams:[]});
    }, batch=>batches.push(JSON.parse(batch)));
    const pending=r.api.getStreams('tt1632701','series',2,9);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(r.calls.filter(url=>url.includes('/stream/')).length,3);
    assert.equal(batches.flat().length,2);
    assert.ok(r.calls.filter(url=>url.includes('/stream/')).every(url=>url.endsWith('/series/tt1632701:2:9.json')));
    assert.ok(!r.calls.some(url=>url.includes('themoviedb')||/vidrock|vixsrc|vaplayer/i.test(url)));
    release(); const results=await pending;
    assert.equal(results.length,2);
    assert.equal(results[0].fileIdx,8);
    assert.equal(results[0].filename,'Suits.S02E09.mkv');
    assert.equal(results[0].behaviorHints.videoSize,2500000000);
});

test('duplicates collapse across providers but original file indices stay distinct',async()=>{
    const r=runtime(async url=>response({streams:url.includes('torrentsdb')?[stream(A,9)]:[stream(A,8)]}));
    const results=await r.api.getStreams('tt1632701:2:9','series');
    assert.equal(results.length,2);
    assert.deepEqual(Array.from(results.map(x=>x.fileIdx)).sort(),[8,9]);
});

test('HTTP and HLS sources are excluded even when labelled full HD',async()=>{
    const r=runtime(async()=>response({streams:[{url:'https://example.invalid/1080p.m3u8'},stream()]}));
    const results=await r.api.getStreams('tt1632701','series',2,9);
    assert.equal(results.length,1);
    assert.ok(results.every(x=>x.url.startsWith('magnet:')&&x.type==='torrent'));
});

test('one failed provider cannot discard other torrent results',async()=>{
    const r=runtime(async url=>url.includes('torrentio')?response({streams:[stream()]}):({ok:false,status:503}));
    assert.equal((await r.api.getStreams('tt1632701','series',2,9)).length,1);
});

test('TMDB identity resolves once and season zero is preserved',async()=>{
    const r=runtime(async url=>url.includes('/external_ids')?response({imdb_id:'tt1632701'}):response({streams:[stream()]}));
    await r.api.getStreams('tmdb:1413','series',0,2);
    assert.equal(r.calls.filter(url=>url.includes('/external_ids')).length,1);
    assert.ok(r.calls.filter(url=>url.includes('/stream/')).every(url=>url.endsWith(':0:2.json')));
});

test('invalid identities never trigger a torrent search',async()=>{
    const r=runtime(async()=>{throw Error('Unexpected request');});
    assert.equal((await r.api.getStreams('not-an-id','series',2,9)).length,0);
    assert.ok(!r.calls.some(url=>url.includes('/stream/')));
});

test('live metadata carries profile identity, crew, logo, and separate season posters',async()=>{
    const data={id:1413,name:'Suits',external_ids:{imdb_id:'tt1632701'},
        credits:{cast:[{id:42,name:'Gabriel Macht',profile_path:'/actor.jpg',character:'Harvey'}],crew:[]},
        aggregate_credits:{cast:[{id:42,name:'Gabriel Macht',profile_path:'/actor.jpg',roles:[{character:'Harvey'}]}],
            crew:[{id:55,name:'Director',profile_path:'/director.jpg',jobs:[{job:'Director'}]}]},
        images:{logos:[{file_path:'/title.png',iso_639_1:'en'}]},
        seasons:[{season_number:1,poster_path:'/s1.jpg'},{season_number:2,poster_path:'/s2.jpg'}]};
    const r=runtime(async url=>{
        if(url.includes('/meta/'))return response({meta:{id:'boat:series:1413',type:'series',tmdbId:1413,name:'Suits',videos:[{season:1},{season:2}]}});
        if(url.includes('/find/'))return response({tv_results:[{id:1413}]});
        if(url.includes('/season/'))return response({episodes:[]});
        return response(data);
    });
    const first=await r.api.getMeta({id:'boat:series:1413',type:'series'});
    assert.equal(first.meta.app_extras.cast[0].tmdbId,42);
    assert.equal(first.meta.app_extras.cast[0].role,'Harvey');
    assert.ok(first.meta.app_extras.cast[0].photo.endsWith('/actor.jpg'));
    assert.equal(first.meta.app_extras.directors[0].tmdbId,55);
    assert.ok(first.meta.logo.endsWith('/title.png'));
    assert.notEqual(first.meta.seasonPosters[1],first.meta.seasonPosters[2]);
    const before=r.calls.length;
    await r.api.getMeta({id:'boat:series:1413',type:'series'});
    assert.equal(r.calls.length,before);
});

test('stalled provider times out while partial results remain available', {timeout:8000},async()=>{
    const batches=[];
    const r=runtime(async(url,options)=>{
        if(url.includes('torrentio'))return response({streams:[stream()]});
        if(url.includes('torrentsdb'))return response({streams:[]});
        return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))));
    },batch=>batches.push(JSON.parse(batch)));
    const started=Date.now(); const pending=r.api.getStreams('tt1632701','series',2,9);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(batches.flat().length,1);
    assert.equal((await pending).length,1);
    assert.ok(Date.now()-started<7000);
});

test('OpenSubtitles results are fetched in parallel and attached to every stream',async()=>{
    const r=runtime(async url=>{
        if(url.includes('/subtitles/'))return response({subtitles:[{url:'https://subs.example/1',lang:'tur'},{url:'https://subs.example/2',lang:'eng'}]});
        return response({streams:url.includes('torrentio')?[stream()]:[stream(B)]});
    });
    const results=await r.api.getStreams('tt1632701','series',2,9);
    assert.equal(results.length,2);
    assert.ok(r.calls.some(url=>url.endsWith('/subtitles/series/tt1632701:2:9.json')));
    for(const item of results){
        assert.equal(item.subtitles.length,2);
        assert.equal(item.subtitles[0].language,'tr');
        assert.ok(item.subtitles.every(sub=>sub.url.startsWith('https://subs.example/')));
    }
});

test('a failed subtitle lookup leaves an empty subtitles array',async()=>{
    const r=runtime(async url=>url.includes('/subtitles/')?({ok:false,status:500}):response({streams:[stream()]}));
    const results=await r.api.getStreams('tt1632701','series',2,9);
    assert.equal(results.length,1);
    assert.ok(Array.isArray(results[0].subtitles));
    assert.equal(results[0].subtitles.length,0);
});

test('a host-provided TMDB key is used without downloading config.json',async()=>{
    for(const globals of [{__get_tmdb_api_key:()=>'host-key'},{TMDB_API_KEY:'host-key'}]){
        const r=runtime(async url=>url.includes('/external_ids')?response({imdb_id:'tt1632701'}):response({streams:[stream()]}),undefined,{globals});
        const results=await r.api.getStreams('tmdb:1413','series',0,2);
        assert.equal(results.length,1);
        const tmdbCalls=r.calls.filter(url=>url.includes('themoviedb'));
        assert.equal(tmdbCalls.length,1);
        assert.ok(tmdbCalls[0].includes('api_key=host-key'));
        assert.ok(!r.calls.some(url=>url.endsWith('/config.json')));
    }
});

test('a null config.json body is not cached and the next call downloads it again',async()=>{
    let attempts=0;
    const r=runtime(async url=>url.includes('/external_ids')?response({imdb_id:'tt1632701'}):response({streams:[stream()]}),undefined,
        {config:()=>++attempts===1?null:DEFAULT_CONFIG});
    assert.equal((await r.api.getStreams('tmdb:1413','series',0,2)).length,0);
    assert.equal(r.warnings.filter(args=>args[0]==='BOAT context failed').length,1);
    assert.ok(!r.calls.some(url=>url.includes('themoviedb')));
    assert.equal((await r.api.getStreams('tmdb:1413','series',0,2)).length,1);
    assert.equal(r.calls.filter(url=>url.endsWith('/config.json')).length,2);
});

test('the same file from two providers merges labels and keeps the highest seeder count',async()=>{
    const r=runtime(async url=>{
        if(url.includes('torrentio'))return response({streams:[stream()]});
        if(url.includes('torrentsdb'))return response({streams:[{...stream(),title:'Suits.S02E09.mkv\n👤 40 💾 2.5 GB'}]});
        return response({streams:[]});
    });
    const results=await r.api.getStreams('tt1632701','series',2,9);
    assert.equal(results.length,1);
    assert.deepEqual(results[0].provider.split(', ').sort(),['Torrentio','TorrentsDB']);
    assert.equal(results[0].seeders,40);
    assert.ok(results[0].name.includes('[👤 40]'));
});

test('Turkish releases are tagged and missing seeders do not produce a zero badge',async()=>{
    const r=runtime(async url=>response({streams:url.includes('torrentio')?[
        {infoHash:A,fileIdx:0,name:'Torrentio',title:'Film.2024.Turkce.Dublaj.1080p.mkv\n💾 1.2 GB'},
        {infoHash:B,fileIdx:0,name:'Torrentio',title:'Film.2024.1080p.mkv\n👤 7 💾 1.2 GB'}]:[]}));
    const results=await r.api.getStreams('tt1632701','movie');
    const turkish=results.find(x=>x.infoHash===A), other=results.find(x=>x.infoHash===B);
    assert.equal(turkish.language,'tr');
    assert.ok(!('language' in other));
    assert.ok(!turkish.name.includes('👤'));
    assert.equal(turkish.seeders,0);
    assert.ok(other.name.includes('[👤 7]'));
});

test('rejected providers are reported once by name',async()=>{
    const r=runtime(async url=>url.includes('torrentio')?response({streams:[stream()]}):({ok:false,status:503}));
    assert.equal((await r.api.getStreams('tt1632701','series',2,9)).length,1);
    const failed=r.warnings.filter(args=>args[0]==='BOAT provider failed').map(args=>args[1]).sort();
    assert.deepEqual(failed,['ThePirateBay+','TorrentsDB']);
});

test('config.json can override provider URLs and the provider timeout', {timeout:8000},async()=>{
    const r=runtime(async(url,options)=>{
        if(url.startsWith('https://alt.example/'))return response({streams:[stream()]});
        if(url.includes('torrentsdb'))return response({streams:[]});
        return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))));
    },undefined,{config:{...DEFAULT_CONFIG,urls:{boat:{torrentio:'https://alt.example/'}},torrent_search:{providerTimeoutMs:150}}});
    const started=Date.now();
    const results=await r.api.getStreams('tt1632701','series',2,9);
    assert.equal(results.length,1);
    assert.ok(r.calls.some(url=>url==='https://alt.example/stream/series/tt1632701:2:9.json'));
    assert.ok(!r.calls.some(url=>url.includes('torrentio.strem.fun')));
    assert.ok(Date.now()-started<2000);
});
