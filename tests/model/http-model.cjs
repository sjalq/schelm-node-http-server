"use strict";
const crypto = require("node:crypto");
const ACTIONS = ["offer","read","eof","send","finish","close","timeout","pipeline","abort"];
function initial() { return { phase:"idle", body:"paused", response:"open", terminal:null, reservations:0, offers:0, rejects:0, forced:0 }; }
function step(s, action) {
  s={...s};
  switch(action) {
    case "offer": if(s.phase==="idle"){s.phase="active";s.reservations=1;s.offers++;} else s.rejects++; break;
    case "read": if(s.phase==="active"&&s.body==="paused")s.body="pending"; break;
    case "eof": if(s.phase==="active"&&(s.body==="pending"||s.body==="paused"))s.body="done"; break;
    case "send": if(s.phase==="active"&&s.response==="open")s.response="ending"; break;
    case "finish": if(s.phase==="active"&&s.response==="ending"){s.response="done";s.terminal=s.terminal||"finish";} break;
    case "close": if(s.phase==="active"){s.terminal=s.terminal||"peer-closed";s.response="done";} break;
    case "timeout": if(s.phase==="active"){s.terminal=s.terminal||"timeout";s.phase="absent";s.reservations=0;s.forced++;} break;
    case "pipeline": if(s.phase==="active")s.rejects++; break;
    case "abort": if(s.phase==="active"){s.terminal=s.terminal||"aborted";s.phase="absent";s.reservations=0;} break;
  }
  if(s.phase==="active"&&s.body==="done"&&s.response==="done"){s.phase="idle";s.reservations=0;}
  return s;
}
function assertInvariant(s){if(s.reservations<0||s.reservations>1)throw Error("reservation bound");if(s.phase!=="active"&&s.reservations!==0)throw Error("absence owns reserve");if(s.offers>1&&s.phase==="active")throw Error("pipelining escaped");}
function exhaustive(depth){let count=0;const terminals={};const visit=(state,left)=>{assertInvariant(state);count++;if(state.terminal)terminals[state.terminal]=(terminals[state.terminal]||0)+1;if(!left)return;for(const a of ACTIONS)visit(step(state,a),left-1);};visit(initial(),depth);return{count,terminals};}
function digest(value){return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");}
module.exports={ACTIONS,initial,step,assertInvariant,exhaustive,digest};
