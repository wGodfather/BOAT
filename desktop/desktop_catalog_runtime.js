const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {cineStreamFetch}=require('./desktop_cinestream_transport');
const {createSettingsReader}=require('./desktop_catalog_settings');
async function providerFetch(url,options={}){
    const target=new URL(String(url)),base='http://127.0.0.1:18765';
    if(target.origin===base && /^(?:\/health|\/playlists|\/transport\/(?:tmdb|simkl|cinejoy)|\/catalog\/domino\/(?:section|search|item|file)|\/live\/register)$/.test(target.pathname))return fetch(url,options);
    const domino=target.href.match(/^https:\/\/raw\.githubusercontent\.com\/dr-octagon\/Cloudstream-BronzeCloud\/builds\/dominotv_(home_bundle|search|series_extra)\.json\.gz$/);
    if(domino)return fetch(base+'/catalog/domino/file?name='+domino[1],{signal:AbortSignal.timeout(15000)});
    const value=await cineStreamFetch({url:String(url),method:options.method,headers:options.headers,body:options.body,redirect:options.redirect,timeoutMs:options.timeout});
    const bytes=Buffer.from(value.bodyBase64,'base64');
    return {ok:value.status>=200&&value.status<300,status:value.status,url:value.url,headers:{get:key=>{const val=value.headers[String(key).toLowerCase()];return Array.isArray(val)?val.join(', '):val || null;},getSetCookie:()=>value.headers['set-cookie'] || []},text:async()=>bytes.toString('utf8'),json:async()=>JSON.parse(bytes.toString('utf8')),arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
}
function createProviderRuntime({providerDir,modulesFile,configFile,fetchImpl=providerFetch,settings={},settingsFile}){
    const modules=require(path.resolve(modulesFile));
    const loaded=new Map();
    const savedSettings=createSettingsReader(settingsFile),revisions=new Map(),snapshots=new Map();
    function refreshSettings(id){
        const value={...savedSettings.get(id),...(settings[id] || {})},snapshot=JSON.stringify(value);
        if(snapshots.get(id)!==snapshot){
            snapshots.set(id,snapshot);revisions.set(id,(revisions.get(id) || 0)+1);
            const cached=loaded.get(id);if(cached)cached.sandbox.SCRAPER_SETTINGS=value;
        }
        return value;
    }
    let localConfig;
    if(configFile && fs.existsSync(configFile))localConfig=JSON.parse(fs.readFileSync(configFile,'utf8'));
    function load(id){
        if(!/^[a-z][a-z0-9_-]*$/.test(id))throw Error('Invalid provider ID');
        const value=refreshSettings(id);
        const filename=path.join(providerDir,id+'.js'),stat=fs.statSync(filename),cached=loaded.get(id);
        if(cached?.mtime===stat.mtimeMs)return cached.api;
        const module={exports:{}};
        const sandbox={module,exports:module.exports,console,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,atob,btoa,AbortController,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,crypto:webcrypto,
            SCRAPER_SETTINGS:value,
            fetch:(url,options)=>localConfig && String(url)==='https://raw.githubusercontent.com/wGodfather/BOAT/main/config.json'?Promise.resolve(new Response(JSON.stringify(localConfig),{headers:{'Content-Type':'application/json'}})):fetchImpl(url,options),
            require:name=>{
                if(['cheerio','cheerio-without-node-native','react-native-cheerio'].includes(name))return modules.cheerio;
                if(name==='crypto-js')return modules.CryptoJS;
                // Same optional-module behavior as Nuvio's require shim.
                return undefined;
            }};
        sandbox.global=sandbox; sandbox.window=sandbox;sandbox.self=sandbox;
        vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename,timeout:3000});
        const api=module.exports;
        loaded.set(id,{mtime:stat.mtimeMs,api,sandbox});
        return api;
    }
    function setSettings(id,value){settings[id]=value || {};refreshSettings(id);}
    function settingsRevision(id){refreshSettings(id);return revisions.get(id) || 0;}
    return {load,setSettings,settingsRevision};
}
module.exports={createProviderRuntime,providerFetch};
