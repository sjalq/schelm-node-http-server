"use strict";
function initial(){return{listeners:2,globalExchanges:0,globalBytes:0,routes:{},pendingReplies:0,close:{completed:0,rejected:0,forced:0}}}
function reserve(s,listener,bytes){if(s.globalExchanges>=1||s.globalBytes+bytes>8)return{...s,rejected:true};return{...s,globalExchanges:s.globalExchanges+1,globalBytes:s.globalBytes+bytes,owner:listener}}
function release(s,outcome){if(!s.globalExchanges)return s;return{...s,globalExchanges:0,globalBytes:0,owner:null,close:{...s.close,[outcome]:s.close[outcome]+1}}}
function route(s,listener,owner){const old=s.routes[listener],generation=old&&old.owner===owner?old.generation:((old&&old.generation)||0)+1;return{...s,routes:{...s.routes,[listener]:{owner,generation}}}}
function closeRoute(s,listener){const routes={...s.routes};delete routes[listener];return{...s,routes}}
function accepts(s,listener,generation){const route=s.routes[listener];return!!route&&route.generation===generation}
function admitWave(s,count){const admitted=Math.min(count,1024,4096-s.pendingReplies);return{...s,pendingReplies:s.pendingReplies+admitted,overloaded:count-admitted}}
module.exports={initial,reserve,release,route,closeRoute,accepts,admitWave};
