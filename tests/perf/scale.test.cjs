"use strict";
const assert=require("node:assert/strict"),{Budget}=require("../../kernel-src/http-server.js");
const b=new Budget(),start=process.hrtime.bigint();for(let listener=1;listener<=200;listener++){for(let i=0;i<50;i++){const id=b.reserve(listener,"connections",1,100);assert.ok(id);assert.equal(b.release(id),true);}}const ms=Number(process.hrtime.bigint()-start)/1e6;assert.equal(b.snapshot().reservations,0);assert.ok(ms<1000,`indexed budget scale ${ms}ms`);console.log(JSON.stringify({listeners:200,operations:10000,ms}));
