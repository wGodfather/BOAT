const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const bundle = fs.readFileSync(path.join(__dirname, '../providers/boat.js'), 'utf8');
const A = 'a'.repeat(40), B = 'b'.repeat(40);
function runtime(fetcher, emit = () => {}) {
    const calls = [];
    const sandbox = {module:{exports:{}}, console, URL, URLSearchParams, TextEncoder, TextDecoder,
        setTimeout, clearTimeout, AbortController, atob, btoa, __emit_streams:emit,
        require: name => name === "cheerio" ? {} : null,
        fetch: async (url, options) => {
            calls.push(String(url));
            if (String(url).endsWith('/config.json')) return {ok:true,json:async()=>({api_keys:{tmdb:'test-key'},metadata:{language:'tr-TR'}})};
            return fetcher(String(url), options || {});
        }};
    vm.createContext(sandbox); vm.runInContext(bundle,sandbox);
    return {api:sandbox.module.exports,calls};
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
