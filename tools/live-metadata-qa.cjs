// Read-only opt-in check of TMDB metadata. Does not fetch or download media/torrents.
const fs = require('node:fs'), vm = require('node:vm');
const sandbox = {module:{exports:{}},console:{log(){},warn(){},error(){}},URL,URLSearchParams,
    TextEncoder,TextDecoder,setTimeout,clearTimeout,AbortController,atob,btoa,fetch,
    require:name=>name==='cheerio'?{}:null};
vm.createContext(sandbox); vm.runInContext(fs.readFileSync('providers/boat.js','utf8'),sandbox);
(async()=>{
    const config = await (await fetch('https://raw.githubusercontent.com/wGodfather/BOAT/main/config.json')).json();
    const request = async (endpoint, extras={}) => {
        const query = new URLSearchParams({api_key:config.api_keys.tmdb,language:'tr-TR',...extras});
        const response = await fetch('https://api.themoviedb.org/3/'+endpoint+'?'+query);
        if(!response.ok)throw Error('TMDB HTTP '+response.status);
        return response.json();
    };
    const found = await request('find/tt1632701',{external_source:'imdb_id'});
    const id = found.tv_results?.[0]?.id;
    if(!id)throw Error('TMDB series identity not found');
    const {meta} = await sandbox.module.exports.getMeta({id:`boat:series:${id}`,type:'series'});
    const people = meta.app_extras?.cast || [];
    const actor = people.find(p=>p.photo&&p.tmdbId);
    const [person,credits] = await Promise.all([request('person/'+actor.tmdbId),request(`person/${actor.tmdbId}/combined_credits`)]);
    let biography = person.biography;
    if(!biography)biography=(await request('person/'+actor.tmdbId,{language:'en-US'})).biography;
    const posterUrls=Object.values(meta.seasonPosters||{});
    const images=[actor.photo,meta.logo,...posterUrls.slice(0,2)];
    const imageStatus=await Promise.all(images.map(async url=>(await fetch(url,{method:'HEAD'})).status));
    const result={series:meta.name,imdbId:meta.imdb_id,tmdbId:id,
        actors:people.length,actorsWithPhotoAndIdentity:people.filter(p=>p.photo&&p.tmdbId).length,
        creativeTeam:meta.app_extras.directors.length,logo:!!meta.logo,
        distinctSeasonPosters:new Set(posterUrls).size,personBiographyAvailable:!!biography,
        personMovies:(credits.cast||[]).filter(x=>x.media_type==='movie').length,
        personSeries:(credits.cast||[]).filter(x=>x.media_type==='tv').length,imageHttpStatus:imageStatus};
    fs.mkdirSync('tmp',{recursive:true});fs.writeFileSync('tmp/live-suits-metadata-qa.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
    if(!(result.imdbId==='tt1632701'&&result.actorsWithPhotoAndIdentity>0&&result.creativeTeam>0&&result.logo&&result.distinctSeasonPosters>1&&result.personMovies>0&&imageStatus.every(x=>x===200)))process.exitCode=1;
})().catch(error=>{console.error(error.name+': read-only metadata check failed');process.exitCode=1;});
