const fs=require('node:fs');
const path=require('node:path');
const PREFIX='settings_https://raw.githubusercontent.com/wgodfather/boat/main/manifest.json:';
function unescape(value){
    return value.replace(/\\(?:u([0-9a-fA-F]{4})|(.))/g,(_,hex,char)=>hex?String.fromCharCode(parseInt(hex,16)):({t:'\t',r:'\r',n:'\n',f:'\f'}[char] || char));
}
// DesktopStorage uses java.util.Properties.load(InputStream): Latin-1 plus
// Unicode escapes, escaped separators, and optional line continuations.
function parseSettings(text){
    const settings=new Map();let continued='';
    for(let line of text.split(/\r\n|\n|\r/)){
        line=continued+line.replace(/^[ \t\f]+/,'');
        if((line.match(/\\+$/)?.[0].length || 0)%2){continued=line.slice(0,-1);continue;}
        continued='';if(!line || /^[#!]/.test(line))continue;
        let at=0;for(;at<line.length;at++){if(line[at]==='\\'){at++;continue;}if(/[=: \t\f]/.test(line[at]))break;}
        const key=unescape(line.slice(0,at));
        if(!key.toLowerCase().startsWith(PREFIX))continue;
        let value=at;while(/[ \t\f]/.test(line[value] || 'x'))value++;
        if(/[=:]/.test(line[value] || 'x'))value++;
        while(/[ \t\f]/.test(line[value] || 'x'))value++;
        const id=key.slice(PREFIX.length);
        if(!/^[a-z][a-z0-9_-]*$/.test(id))continue;
        const parsed=JSON.parse(unescape(line.slice(value)));
        if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw Error('Invalid saved plugin settings');
        settings.set(id,parsed);
    }
    return settings;
}
function defaultSettingsFile(){return process.platform==='win32' && process.env.APPDATA?path.join(process.env.APPDATA,'Nuvio','nuvio_plugins.properties'):undefined;}
function createSettingsReader(filename=defaultSettingsFile()){
    let signature,values=new Map();
    function refresh(){
        if(!filename)return;
        try{
            const stat=fs.statSync(filename),next=[stat.mtimeMs,stat.ctimeMs,stat.size].join(':');
            if(next===signature)return;
            if(stat.size>64*1024*1024)throw Error('Plugin preferences too large');
            const parsed=parseSettings(fs.readFileSync(filename,'latin1'));
            values=parsed;signature=next;
        }catch(error){
            if(error.code==='ENOENT'){values=new Map();signature=undefined;}
            // Keep the last complete snapshot if the app is currently writing.
            // Never print file contents or the user's credentials.
        }
    }
    return {get(id){refresh();return values.get(id) || {};}};
}
module.exports={createSettingsReader,parseSettings,defaultSettingsFile};
