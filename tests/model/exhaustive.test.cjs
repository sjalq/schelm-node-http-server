"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {exhaustive,digest,initial,step}=require("./http-model.cjs");
test("bounded exhaustive exchange traces",()=>{const summary=exhaustive(7);assert.equal(summary.count,5380840);assert.ok(summary.terminals.finish>0);assert.ok(summary.terminals["peer-closed"]>0);assert.ok(summary.terminals.timeout>0);const golden=JSON.parse(fs.readFileSync(path.join(__dirname,"golden.json")));assert.deepEqual({summary,digest:digest(summary)},golden);});
test("finish wins over late close and close wins before finish",()=>{let s=initial();for(const a of ["offer","send","finish","close"])s=step(s,a);assert.equal(s.terminal,"finish");s=initial();for(const a of ["offer","send","close","finish"])s=step(s,a);assert.equal(s.terminal,"peer-closed");});
test("pipelining never creates a second offer",()=>{let s=initial();for(const a of ["offer","pipeline","pipeline"])s=step(s,a);assert.equal(s.offers,1);assert.equal(s.rejects,2);assert.equal(s.reservations,1);});
