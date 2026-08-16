function clone(v){return structuredClone(v)}
function rand(n){let t=(n+0x6d2b79f5)|0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}
export function createGame({seed=1,chapter=1}={}){return {seed:Number(seed)||1,turn:0,score:0,outcome:"playing",message:"準備就緒",chapter,units:[{id:"槍",type:"spear",hp:12,x:0,y:0,side:"you"},{id:"弓",type:"bow",hp:9,x:0,y:1,side:"you"},{id:"騎",type:"cavalry",hp:14,x:0,y:2,side:"you"},{id:"敵槍",type:"spear",hp:11,x:4,y:0,side:"foe"},{id:"敵弓",type:"bow",hp:9,x:4,y:2,side:"foe"}],selected:0}}
export function getLegalActions(s){return s.outcome==="playing"?["move", "attack", "wait", "nextUnit"]:[]}
export function applyAction(state,action){const s=clone(state);if(!getLegalActions(s).includes(action))return s;s.message={"move": "移動", "attack": "攻擊", "wait": "待機", "nextUnit": "換單位"}[action];if(action==="nextUnit")s.selected=(s.selected+1)%3;
else if(action==="move"){const u=s.units[s.selected];u.x=Math.min(4,u.x+1)}
else if(action==="attack"){const u=s.units[s.selected],e=s.units.find(v=>v.side==="foe"&&v.hp>0);if(e){const beats={spear:"cavalry",cavalry:"bow",bow:"spear"};e.hp-=beats[u.type]===e.type?7:4}}
for(const e of s.units.filter(v=>v.side==="foe"&&v.hp>0)){const u=s.units.find(v=>v.side==="you"&&v.hp>0);if(u){e.x=Math.max(0,e.x-1);if(Math.abs(e.x-u.x)<=1)u.hp-=2}}
if(!s.units.some(v=>v.side==="foe"&&v.hp>0)){if(s.chapter===3)s.outcome="won";else{const n=createGame({seed:s.seed+s.chapter,chapter:s.chapter+1});return n}}
if(!s.units.some(v=>v.side==="you"&&v.hp>0))s.outcome="lost";return s}
export function summarize(s){return {turn:s.turn,score:s.score,outcome:s.outcome,message:s.message}}
export function getOutcome(s){return s.outcome}
