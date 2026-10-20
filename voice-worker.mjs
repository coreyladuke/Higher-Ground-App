/** Higher Ground HG-026P: voice transcription unchanged; adds private Reflection Pond AI route.
 * Secrets never belong in a GitHub HTML file. AI binding: AI.
 * Adds /v1/pond for short question-only AI replies. Neither endpoint grants XP.
 */
const ORIGIN = 'https://coreyladuke.github.io';
const AUDIO_BYTES_MAX = 3500000;
const TYPES = ['audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/wav','audio/x-wav','audio/aac','audio/x-m4a'];
function headers(req){return req.headers.get('Origin')===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}:null;}
function reply(req, data, code=200){return new Response(JSON.stringify(data),{status:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(headers(req)||{})}});}
function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export default {async fetch(req, env){
 const cors=headers(req);
 if(!cors)return reply(req,{error:'This test accepts requests only from Higher Ground.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const path=new URL(req.url).pathname;
 if(path==='/health'&&req.method==='GET')return reply(req,{ready:!!env.AI?.run,model:'whisper-large-v3-turbo',prototype:true});
 if(!['/v1/transcribe','/v1/pond','/v1/life'].includes(path)||req.method!=='POST')return reply(req,{error:'Not found'},404);
 const secret=String(env.HG_VOICE_TOKEN||'');
 if(secret.length<16||req.headers.get('Authorization')!==`Bearer ${secret}`)return reply(req,{error:'Incorrect private test code. Configure HG_VOICE_TOKEN in Cloudflare.'},401);
 if(!env.AI?.run)return reply(req,{error:'Workers AI binding AI is missing. Add AI binding in Cloudflare Worker settings.'},503);
 if(path==='/v1/pond')return pond(req,env);
 if(path==='/v1/life')return life(req,env);
 const type=(req.headers.get('Content-Type')||'').split(';')[0].toLowerCase().trim();
 if(!TYPES.includes(type))return reply(req,{error:'Unsupported recording format: '+type},415);
 const clen=Number(req.headers.get('Content-Length')||'0');
 if(clen>AUDIO_BYTES_MAX)return reply(req,{error:'Audio is too large. Record a shorter answer.'},413);
 let bytes;
 try{const data=await req.arrayBuffer();bytes=new Uint8Array(data);if(bytes.byteLength<200||bytes.byteLength>AUDIO_BYTES_MAX)throw Error('Audio size limit');}
 catch(_){return reply(req,{error:'Recording was empty or exceeded 3.5MB.'},413)}
 try{
  const model=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio:toBase64(bytes),task:'transcribe',language:'en'});
  const text=String(model?.text||model?.response?.text||'').trim();
  if(!text)return reply(req,{error:'The model did not hear any recognizable speech. Try speaking a little closer.'},422);
  return reply(req,{text:text.slice(0,4000),provider:'Cloudflare Whisper Large v3 Turbo',audioStoredByThisWorker:false});
 }catch(e){return reply(req,{error:'Cloudflare transcription unavailable. Check AI binding, free allocation, and audio format.',detail:String(e?.message||e).slice(0,200)},503)}
}};


// HG-026P founder-only Reflection Pond. Does not mutate the proven /v1/transcribe route.
// No raw user text, audio or conversation history is saved by this Worker.
const POND_MODEL='@cf/meta/llama-3.1-8b-instruct-fp8';
const POND_RULES=`You are the Reflection Pond in Higher Ground, an adult self-reflection practice.
You are not a therapist, human friend, judge, diagnosis engine, or advice service.
A person may share ordinary events, a success, pain, confusion, humor, or a sentence they simply wanted to say somewhere.
Normally return exactly ONE short thoughtful open question, preferably 6–18 words. It must directly relate to the latest actual words; don't assume missing facts, diagnose, shame, fix, flatter, moralize, or change the subject toward problems when they share joy. One single question mark. Don't stack questions. Don't repeat earlier questions. Be natural and sometimes gently surprising if the speaker's tone invites it.
Sometimes the best response is SILENCE. If the person says they want to stop, have already found an insight, say they only needed to express it, seem done, or have already answered several questions, choose stillness. Never pressure them to stay and never offer another question after a natural end.
If the user's latest message suggests imminent self-harm or immediate danger, switch to a brief supportive safety message rather than a probing question. Do not promise confidentiality, human presence or rescue.
Respond with JSON only, on one line, in this schema: {"kind":"question"|"still"|"safety","text":"..."}. For still, text must be empty. For question, text is one question only. For safety, text is brief compassionate grounding and practical immediate-safety guidance, without diagnosing. Never include markdown.`;
function doneSignal(s){return /^(?:ok|okay|thanks|thank you|that(?:'s| is) (?:it|all)|(?:i(?:'m| am) )?done|no more|stop|leave it here|i(?:'ve| have) got it|i(?:'ve| have) said enough|i just wanted to say (?:that|it)|i don't want to (?:answer|talk)|no (?:more )?questions)[.!\s]*$/i.test(s.trim());}
function safeClip(str,n){return String(str||'').trim().slice(0,n);}
function parsePond(raw){
 const out=String(raw||'').trim();
 let data;
 try{data=JSON.parse(out)}catch(_){const match=out.match(/\{[\s\S]*?\}/);if(match)try{data=JSON.parse(match[0])}catch(__){}}
 if(!data||typeof data!=='object'||!['question','still','safety'].includes(data.kind))return null;
 if(data.kind==='still')return {kind:'still',text:''};
 let t=safeClip(data.text,400).replace(/\s+/g,' ');
 if(data.kind==='safety'){return t?{kind:'safety',text:t}:null;}
 if(!t.includes('?'))return null;
 // Strip model-generated secondary question/lectures, preserve exactly one short standalone question.
 t=t.slice(0,t.indexOf('?')+1);
 if(t.length<7||t.length>220||t.split(/\s+/).length>35)return null;
 return {kind:'question',text:t};
}
async function pond(req,env){
 if(!(req.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))return reply(req,{error:'Expected JSON.'},415);
 const max=14000;const len=Number(req.headers.get('Content-Length')||'0');if(len>max)return reply(req,{error:'Message too long for this small reflection test.'},413);
 let data;
 try {const text=await req.text();if(text.length>max)throw Error('oversize');data=JSON.parse(text)}catch(_){return reply(req,{error:'Invalid or oversized JSON.'},400)}
 const latest=typeof data?.message==='string'?data.message.trim():'';
 if(!latest||latest.length>1300)return reply(req,{error:'Please use 1–1300 characters for one thought.'},400);
 let turns=Number(data?.questionCount)||0;if(!Number.isInteger(turns)||turns<0||turns>50)return reply(req,{error:'Invalid question count.'},400);
 if(/\bi(?:'m| am) (?:about to|going to|planning to) (?:kill|hurt) myself\b|\bi (?:will|intend to) (?:kill|hurt) myself\b|\bi(?:'ve| have) (?:made a plan|decided) to (?:end my life|kill myself)\b/i.test(latest))return reply(req,{kind:'safety',text:'If you might hurt yourself soon, please move away from anything you could use to hurt yourself, contact emergency services, and ask someone you trust to stay with you. In the U.S., call or text 988.',source:'safety-rule',stored:false});
 if(doneSignal(latest)||turns>=4)return reply(req,{kind:'still',text:'',source:'rule',stored:false});
 const history=Array.isArray(data?.history)?data.history.slice(-6):[];
 const validated=history.filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string')
  .map(x=>({role:x.role,content:safeClip(x.content,850)}));
 try{
  const ai=await env.AI.run(POND_MODEL,{messages:[{role:'system',content:POND_RULES},...validated,{role:'user',content:latest}],temperature:0.65,max_tokens:170});
  const raw=ai?.response??ai?.result?.response??'';
  const parsed=parsePond(raw);
  if(!parsed)return reply(req,{error:'The AI could not form a clear single question. Your words have not been saved. Please retry or leave it here.'},502);
  return reply(req,{...parsed,source:'workers-ai',stored:false});
 }catch(_){return reply(req,{error:'Reflection AI could not respond right now. Your thought remains only in this browser until you leave.'},503)}
}


// HG-034 founder-only LIFE two-turn proof. The existing transcription and Pond
// code above is unchanged. No database, XP, localStorage, or server-side memory.
// This route must not be exposed as a consumer login system.
const LIFE_MODEL='@cf/meta/llama-3.1-8b-instruct-fp8';
const LIFE_SCENARIO={
 id:'friend-couch',
 character:'Rae',
 opening:"Hey, could you help me pick up a couch tonight? I know it's short notice."
};
const LIFE_INSTRUCTIONS=`You are Rae, a believable adult in a short, fictional LIFE roleplay in Higher Ground. You are TEXTING a friend (the PLAYER), who is free to respond in any way. Stay Rae, not a coach, chatbot, or narrator.
SCENE: You've asked: "Hey, could you help me pick up a couch tonight? I know it's short notice." Your backstory: A seller can only meet tonight, and you have borrowed a truck for a narrow pickup window. Reveal details conversationally when it makes sense, particularly when asked why it's urgent. Don't fabricate shared real-world history.
Rae's voice: casual, slightly stressed, imperfect, good-humored if the player jokes. You can be disappointed, curious, relieved, confused, or mildly defensive as appropriate. You NEVER guilt, insult, pressure, manipulate, or chastise them. Accept a no. If the player offers a creative alternative, take it seriously. When they correct themselves, notice and respond to the correction. When they ask a question, answer it before moving on. If they are frustrated, let Rae recognize that her last-minute request might be annoying. Don't spill all background at once or force a neat resolution.
THE CRITICAL GOAL: React SPECIFICALLY to the latest player's actual words AND to earlier parts of this exact exchange. What the player chooses should visibly change Rae's next message. NEVER cycle generic lines, turn it into a lesson, flatter the player, award points, tell them what their decision says about their character, or offer an answer menu. At most one genuine short question from Rae when natural. No repetitious 'I understand' or 'That makes sense'.
Length: conversational one or two SHORT sentences, 12–48 words total, no asterisks, labels, emojis, bullet lists or quotation marks around the whole message. If the player leaves or says they're done, Rae simply accepts it. The player can finish at any time.
Return ONLY valid JSON: {"reply":"Rae's next actual text message","shift":"ask"|"clarify"|"compromise"|"friction"|"relief"|"close"}. Pick shift as a loose scene mood, NOT a grade or judgment. Do not add any other keys. The AI is not allowed to mutate points or stored progress.
Safety exception: For a clearly immediate self-harm danger disclosed as a real-life emergency, briefly respond out of character with practical safety support rather than continuing a playful scene. No confident diagnosis or invented factual claims.`;
function lifeClean(txt){return String(txt||'').trim().slice(0,750).replace(/\s+/g,' ')}
function parseLife(output){
 let src=output;
 if(src&&typeof src==='object'&&typeof src.reply==='string'){
  // Some Cloudflare model outputs may already be structured.
 } else if(src&&typeof src==='object') src=src.response??src.result?.response??'';
 if(typeof src==='string'){
  const raw=src.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{src=JSON.parse(raw)}catch(_){const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
   if(a>=0&&b>a)try{src=JSON.parse(raw.slice(a,b+1))}catch(__){}
  }
  // A genuinely generated plain-text reply is still useful; never claim JSON semantics.
  if(typeof src==='string'&&src.length>8&&src.length<450&&!src.includes('{'))
   return {reply:src.replace(/^Rae\s*:\s*/i,'').trim().slice(0,350),shift:'clarify'};
 }
 if(!src||typeof src!=='object'||typeof src.reply!=='string')return null;
 let line=src.reply.replace(/^Rae\s*:\s*/i,'').trim().replace(/\s+/g,' ').slice(0,450);
 if(line.length<5||line.length>380||!/[.!?…]$/.test(line))return null;
 const modes=new Set(['ask','clarify','compromise','friction','relief','close']);
 return {reply:line,shift:modes.has(src.shift)?src.shift:'clarify'};
}
async function life(req,env){
 const contentType=(req.headers.get('Content-Type')||'').toLowerCase();
 if(!contentType.startsWith('application/json'))return reply(req,{error:'Expected a JSON text message.'},415);
 if(Number(req.headers.get('Content-Length')||0)>14000)return reply(req,{error:'Message too long.'},413);
 let payload;try{const body=await req.text();if(body.length>14000)throw Error('Oversized');payload=JSON.parse(body)}
 catch(_){return reply(req,{error:'Invalid or oversized request.'},400)}
 if(payload?.scenarioId!==LIFE_SCENARIO.id)return reply(req,{error:'Unknown LIFE scene. This test offers one fictional encounter.'},400);
 const latest=typeof payload?.message==='string'?payload.message.trim():'';
 if(latest.length<1||latest.length>1200)return reply(req,{error:'Please send 1–1200 characters.'},400);
 if(!Array.isArray(payload?.history)||payload.history.length>8)return reply(req,{error:'Invalid exchange history.'},400);
 const history=[];
 for(const h of payload.history){
  if(!h||!['user','assistant'].includes(h.role)||typeof h.content!=='string'||!h.content.trim()||h.content.length>1200)
   return reply(req,{error:'Invalid exchange history.'},400);
  history.push({role:h.role,content:lifeClean(h.content)});
 }
 if(history.length && history[0].role!=='user')return reply(req,{error:'Invalid turn order.'},400);
 for(let i=1;i<history.length;i++)if(history[i].role===history[i-1].role)return reply(req,{error:'Invalid turn order.'},400);
 if(history.length && history[history.length-1].role!=='assistant')return reply(req,{error:'The latest message is already in history. Please send it only once.'},400);
 // User control: no more than four turns in this tiny prototype. Start a new scene freely.
 if(history.filter(h=>h.role==='user').length>=4)return reply(req,{error:'This short scene has reached its turn limit. Start again to explore another approach.'},409);
 if(/\bi(?:'m| am) (?:about to|going to|planning to) (?:kill|hurt) myself\b|\bi (?:will|intend to) (?:kill|hurt) myself\b/i.test(latest))
  return reply(req,{reply:'If you might hurt yourself soon, please reach out to emergency services or a trusted person now. In the U.S. you can call or text 988.',shift:'close',source:'safety-rule',stored:false});
 const messages=[
  {role:'system',content:LIFE_INSTRUCTIONS},
  {role:'assistant',content:LIFE_SCENARIO.opening},
  ...history,
  {role:'user',content:lifeClean(latest)}
 ];
 try{
  const raw=await env.AI.run(LIFE_MODEL,{messages,temperature:0.68,max_tokens:190,stream:false});
  const result=parseLife(raw);
  if(!result)return reply(req,{error:'Rae did not form a clear reply. Your draft is still in the browser. Please try again.'},502);
  return reply(req,{...result,source:'workers-ai',scenarioId:LIFE_SCENARIO.id,stored:false});
 }catch(_){return reply(req,{error:'Live AI is unavailable. No canned answer was substituted. Try again later.'},503)}
}
