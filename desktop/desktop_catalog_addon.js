const fs=require('node:fs');
const path=require('node:path');
const {createProviderRuntime}=require('./desktop_catalog_runtime');
const TYPES=['movie','series','anime','tv'];
function createCatalogAddon(options={}){
    const root=options.root || path.resolve(__dirname,'..');
    const desktop=fs.existsSync(path.join(root,'dist/desktop/catalog-inventory.json'))?path.join(root,'dist/desktop'):path.join(root,'desktop');
    const inventoryFile=options.inventoryFile || path.join(desktop,'catalog-inventory.json');
    if(!fs.existsSync(inventoryFile))return {handle:async()=>false};
    const inventory=JSON.parse(fs.readFileSync(inventoryFile,'utf8'));
    const runtime=options.runtime || createProviderRuntime({providerDir:fs.existsSync(path.join(root,'dist/providers'))?path.join(root,'dist/providers'):path.join(root,'providers'),modulesFile:path.join(desktop,'runtime_modules.cjs'),configFile:path.join(root,'config.json')});
    const registry=new Map(inventory.providers.map(provider=>[provider.id,provider]));
    const catalogMap=new Map();
    const catalogs=inventory.providers.flatMap(provider=>TYPES.flatMap(type=>{
        const categories=provider.catalogs.filter(category=>category.type===type);
        if(!categories.length)return [];
        const id='bc_'+provider.id+'_'+type,choices=categories.map(category=>({id:category.id,label:category.name}));
        const labelCounts=new Map();
        for(const choice of choices)labelCounts.set(choice.label,(labelCounts.get(choice.label) || 0)+1);
        for(const choice of choices)if(labelCounts.get(choice.label)>1)choice.label+=' ('+choice.id+')';
        catalogMap.set(id,{provider,type,choices});
        return [{id,type,name:provider.name,extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false},{name:'genre',isRequired:false,options:choices.map(item=>item.label)}]}];
    }));
    const prefixes=inventory.providers.map(provider=>provider.id+':');
    const manifest={id:'community.nuvio.boat.catalogs',version:inventory.version,name:'B.O.A.T Katalogları',description:'B.O.A.T kategorileri, araması ve bölüm listeleri',resources:[{name:'catalog',types:TYPES},{name:'meta',types:TYPES,idPrefixes:prefixes},{name:'stream',types:TYPES,idPrefixes:prefixes},{name:'subtitles',types:TYPES,idPrefixes:prefixes}],types:TYPES,idPrefixes:prefixes,catalogs,behaviorHints:{adult:false}};
    const ownership=new Map(),episodes=new Map();
    function remember(meta,provider){
        if(!meta?.id)return;
        ownership.set(meta.type+'|'+meta.id,provider.id);
        for(const video of meta.videos || [])if(video.id)episodes.set(video.id,{provider:provider.id,id:meta.id,type:meta.type,season:video.season,episode:video.episode});
        while(ownership.size>10000)ownership.delete(ownership.keys().next().value);
        while(episodes.size>20000)episodes.delete(episodes.keys().next().value);
    }
    function owner(id,type){return registry.get(episodes.get(id)?.provider || ownership.get(type+'|'+id) || id.split(':')[0]);}
    const metaCache=new Map();
    async function meta(id,type){
        const provider=owner(id,type);if(!provider)return {meta:null};
        const key=provider.id+'|'+(runtime.settingsRevision?.(provider.id) || 0)+'|'+type+'|'+id;
        if(!metaCache.has(key)){
            const promise=Promise.resolve(runtime.load(provider.id).getMeta({id,type})).then(result=>{remember(result?.meta,provider);return result;});
            metaCache.set(key,promise);promise.catch(()=>metaCache.delete(key));
            if(metaCache.size>500)metaCache.delete(metaCache.keys().next().value);
        }
        return metaCache.get(key);
    }
    async function handle(req,res,send){
        const url=new URL(req.url,'http://127.0.0.1');
        if(!url.pathname.startsWith('/addon/'))return false;
        if(req.method!=='GET'){send(405,{error:'Read-only catalog addon'});return true;}
        if(url.pathname==='/addon/manifest.json'){send(200,manifest);return true;}
        try{
            const match=url.pathname.match(/^\/addon\/(catalog|meta|stream|subtitles)\/([^/]+)\/([^/]+?)(?:\/([^/]*))?\.json$/);
            if(!match){send(404,{error:'Unknown addon route'});return true;}
            const [,resource,type,encodedId,encodedExtra]=match,id=decodeURIComponent(encodedId);
            if(!TYPES.includes(type))throw Error('Unsupported catalog type');
            if(resource==='catalog'){
                const catalog=catalogMap.get(id);if(!catalog || catalog.type!==type){send(404,{metas:[]});return true;}
                const extra=Object.fromEntries(new URLSearchParams(encodedExtra || url.search));
                extra.skip=Math.max(0,Math.min(100000,Number(extra.skip) || 0));
                if(extra.search && extra.search.length>200)throw Error('Search too long');
                const choice=catalog.choices.find(item=>item.label===extra.genre) || catalog.choices[0];
                const result=await runtime.load(catalog.provider.id).getCatalog(type,choice.id,extra);
                for(const item of result?.metas || [])remember(item,catalog.provider);
                send(200,result || {metas:[]});return true;
            }
            if(resource==='meta'){send(200,await meta(id,type));return true;}
            const provider=owner(id,type);if(!provider){send(404,{[resource==='stream'?'streams':'subtitles']:[]});return true;}
            const episode=episodes.get(id),api=runtime.load(provider.id);
            if(resource==='stream')send(200,{streams:await api.getStreams(id,type,episode?.season,episode?.episode) || []});
            else send(200,{subtitles:typeof api.getSubtitles==='function'?await api.getSubtitles(id,type,episode?.season,episode?.episode):[]});
            return true;
        }catch(error){send(502,{error:error.message});return true;}
    }
    return {handle,manifest};
}
module.exports={createCatalogAddon};
