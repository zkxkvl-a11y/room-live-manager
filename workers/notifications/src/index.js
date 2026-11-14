import webpush from 'web-push';

const PROJECT='room-live-manager';
const DB_URL='https://room-live-manager-default-rtdb.asia-southeast1.firebasedatabase.app';
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=str=>Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const sha=async value=>encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const cors=(response,origin,allowed)=>{if(origin===allowed){response.headers.set('Access-Control-Allow-Origin',allowed);response.headers.set('Vary','Origin');response.headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');response.headers.set('Access-Control-Allow-Methods','POST, DELETE, OPTIONS')}return response};
let jwks={until:0,keys:[]};
async function verifyIdToken(token){
  const parts=token.split('.');if(parts.length!==3)throw Error('invalid token');
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=='RS256'||!header.kid||claims.aud!==PROJECT||claims.iss!=='https://securetoken.google.com/'+PROJECT||!claims.sub||claims.sub.length>128||claims.exp<=now||claims.iat>now||claims.auth_time>now)throw Error('invalid claims');
  if(Date.now()>jwks.until){const response=await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');if(!response.ok)throw Error('key lookup failed');jwks={keys:(await response.json()).keys,until:Date.now()+3600000}}
  const key=jwks.keys.find(k=>k.kid===header.kid);if(!key)throw Error('unknown key');
  const imported=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',imported,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('invalid signature');
  return claims.sub;
}
async function accessToken(env){
  const email=env.FIREBASE_CLIENT_EMAIL,privateKey=env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n');
  if(!email||!privateKey)throw Error('service account not configured');
  const now=Math.floor(Date.now()/1000);
  const header=encode(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload=encode(new TextEncoder().encode(JSON.stringify({iss:email,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3000})));
  const raw=decode(privateKey.replace(/-----[^-]+-----/g,'').replace(/\s/g,'').replace(/\+/g,'-').replace(/\//g,'_'));
  const key=await crypto.subtle.importKey('pkcs8',raw,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=encode(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(header+'.'+payload)));
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:header+'.'+payload+'.'+signature})});
  if(!response.ok)throw Error('service token failed');
  return (await response.json()).access_token;
}
async function dbRead(env,path,token){
  const response=await fetch(DB_URL+'/'+path+'.json?access_token='+encodeURIComponent(token),{headers:{'cache-control':'no-cache'}});
  if(!response.ok)throw Error('firebase read failed '+response.status);
  return response.json();
}
async function authorized(env,uid,token){
  if(uid===env.ADMIN_UID)return true;
  const role=await dbRead(env,'roomLiveAccess/'+encodeURIComponent(uid),token);
  return role==='worker'||role==='staff'||role==='observer';
}
function values(v){return Array.isArray(v)?v.filter(Boolean):v&&typeof v==='object'?Object.values(v).filter(Boolean):[]}
async function sendNotifications(env,roomName,eventId){
  webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  const rows=await env.DB.prepare('SELECT id,uid,subscription FROM subscriptions').all();
  const token=await accessToken(env);
  const allowed=new Map();
  let sent=0,failed=0;
  for(const row of rows.results){
    try{
      if(!allowed.has(row.uid))allowed.set(row.uid,await authorized(env,row.uid,token));
      if(!allowed.get(row.uid)){await env.DB.prepare('DELETE FROM subscriptions WHERE id=?').bind(row.id).run();continue}
      await webpush.sendNotification(JSON.parse(row.subscription),JSON.stringify({title:'ROOM LIVE · 시간 종료',body:roomName+' 방 이용 시간이 종료됐습니다.',tag:eventId}),{TTL:120,urgency:'normal'});
      sent++;
    }catch(e){
      if(e.statusCode===404||e.statusCode===410)await env.DB.prepare('DELETE FROM subscriptions WHERE id=?').bind(row.id).run();
      else failed++;
    }
  }
  return {sent,failed};
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin')||'';
    const allowed=env.APP_ORIGIN;
    if(request.method==='OPTIONS')return cors(new Response(null,{status:204}),origin,allowed);
    if(origin!==allowed)return json({error:'origin not allowed'},403);
    const respond=(v,s)=>cors(json(v,s),origin,allowed);
    if(!env.DB||!env.ADMIN_UID||!env.FIREBASE_CLIENT_EMAIL||!env.FIREBASE_PRIVATE_KEY)return respond({error:'server not configured'},503);
    if(new URL(request.url).pathname!=='/subscriptions'||!['POST','DELETE'].includes(request.method))return respond({error:'not found'},404);
    const auth=request.headers.get('Authorization')||'';
    if(!auth.startsWith('Bearer '))return respond({error:'unauthorized'},401);
    let uid;
    try{uid=await verifyIdToken(auth.slice(7));if(!await authorized(env,uid,await accessToken(env)))return respond({error:'forbidden'},403)}
    catch{return respond({error:'unauthorized'},401)}
    let body;try{body=await request.json()}catch{return respond({error:'invalid json'},400)}
    const sub=body?.subscription,endpoint=sub?.endpoint;
    if(typeof endpoint!=='string'||endpoint.length>2048||!endpoint.startsWith('https://')||typeof sub?.keys?.p256dh!=='string'||typeof sub?.keys?.auth!=='string')return respond({error:'invalid subscription'},400);
    const id=await sha(uid+'|'+endpoint);
    if(request.method==='DELETE'){await env.DB.prepare('DELETE FROM subscriptions WHERE id=? AND uid=?').bind(id,uid).run();return respond({ok:true})}
    await env.DB.prepare('INSERT INTO subscriptions(id,uid,endpoint,subscription,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,created_at=excluded.created_at').bind(id,uid,endpoint,JSON.stringify(sub),Date.now()).run();
    return respond({ok:true},201);
  },
  async scheduled(_event,env){
    if(!env.DB||!env.FIREBASE_CLIENT_EMAIL||!env.FIREBASE_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return;
    const token=await accessToken(env);
    const v2=await dbRead(env,'roomLiveV2/config/active',token);
    const root=v2===true?await dbRead(env,'roomLiveV2/operations',token):await dbRead(env,'roomLive',token);
    if(!root)return;
    const now=Date.now(),rooms=values(root.rooms);
    for(const room of rooms){
      if(!room||typeof room.ends!=='number'||room.ends>now||room.ends<now-180000||!room.started)continue;
      const key=await sha(String(room.uid||room.id)+'|'+room.ends);
      const result=await env.DB.prepare('INSERT OR IGNORE INTO deliveries(event_id,room_name,created_at) VALUES(?,?,?)').bind(key,String(room.id||'방'),now).run();
      if(result.meta.changes!==1)continue;
      // Deduplication is at-most-once per room/end timestamp. Failures are logged, not blindly resent.
      const outcome=await sendNotifications(env,String(room.id||'방'),key);
      if(outcome.failed)console.error('push delivery failures',outcome.failed);
    }
    await env.DB.prepare('DELETE FROM deliveries WHERE created_at < ?').bind(now-30*86400000).run();
  }
};
