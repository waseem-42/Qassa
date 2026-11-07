// Verify Windows Job Object cleanup with disposable server/ffmpeg/python processes only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'),temp=mkdtempSync(join(root,'artifacts/desktop-process-check-'));
const python=process.env.EDIT_QA_PYTHON;if(!python)throw Error('Set EDIT_QA_PYTHON to the private first-run Python');
const ffmpeg=join(root,'packages/desktop/resources/bin/ffmpeg.exe'),supervisor=join(root,'packages/desktop/supervisor.ps1'),script=join(temp,'server.cjs'),pidsFile=join(temp,'pids.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
const wait=async(fn,label)=>{for(let i=0;i<100;i++){if(fn())return;await sleep(100)}throw Error(label)};
writeFileSync(script,`const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const a=spawn(${JSON.stringify(ffmpeg)},['-v','error','-re','-f','lavfi','-i','color=s=32x32:r=1','-f','null','-'],{windowsHide:true,stdio:'ignore'});const b=spawn(${JSON.stringify(python)},['-c','import time; time.sleep(900)'],{windowsHide:true,stdio:'ignore'});writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.pid,a.pid,b.pid]));setInterval(()=>{},1000);`);
let guard,parent,pids=[];
try{
 guard=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',supervisor],{env:{...process.env,EDIT_NODE_EXE:process.execPath,EDIT_SERVER_SCRIPT:script,EDIT_PARENT_PID:String(process.pid),EDIT_LOG_DIR:temp,EDIT_SERVER_LOG:'qa'},windowsHide:true,stdio:'ignore'});
 await wait(()=>{try{pids=JSON.parse(readFileSync(pidsFile));return pids.length===3&&pids.every(alive)}catch{return false}},'children started');
 // Kill only the server, leaving its descendants for the guardian to reap.
 spawnSync('taskkill',['/PID',String(pids[0]),'/F'],{windowsHide:true});await wait(()=>pids.every(pid=>!alive(pid)),'all descendants reaped after server crash');await wait(()=>guard.exitCode!==null,'guardian exit');
 console.log('PASS: server crash closes its Windows Job Object; real ffmpeg and Python descendants are gone.');
 rmSync(pidsFile);const parentScript=join(temp,'parent.cjs');
 writeFileSync(parentScript,`const {spawn}=require('node:child_process');spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',${JSON.stringify(supervisor)}],{env:{...process.env,EDIT_NODE_EXE:process.execPath,EDIT_SERVER_SCRIPT:${JSON.stringify(script)},EDIT_PARENT_PID:String(process.pid),EDIT_LOG_DIR:${JSON.stringify(temp)},EDIT_SERVER_LOG:'parent-qa'},windowsHide:true,stdio:'ignore'});setInterval(()=>{},1000);`);
 parent=spawn(process.execPath,[parentScript],{windowsHide:true,stdio:'ignore'});
 await wait(()=>{try{pids=JSON.parse(readFileSync(pidsFile));return pids.every(alive)}catch{return false}},'parent-owned children started');
 spawnSync('taskkill',['/PID',String(parent.pid),'/F'],{windowsHide:true});await wait(()=>pids.every(pid=>!alive(pid)),'all descendants reaped after parent crash');
 console.log('PASS: parent crash also reaps the server, ffmpeg and Python.');
}finally{if(parent?.exitCode===null)spawnSync('taskkill',['/PID',String(parent.pid),'/T','/F'],{windowsHide:true});if(guard?.exitCode===null)spawnSync('taskkill',['/PID',String(guard.pid),'/T','/F'],{windowsHide:true});for(const pid of pids)if(alive(pid))spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true});assert.equal(dirname(temp),join(root,'artifacts'));rmSync(temp,{recursive:true,force:true})}
