import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const errorCodes=new Set(['ETIMEDOUT','ENOENT','EACCES','EPERM','E2BIG','ENOMEM','EINVAL']);
const signals=new Set(['SIGTERM','SIGKILL','SIGABRT','SIGINT']);

export function selectPowerShell7(candidates,{probe=spawnSync,now=()=>performance.now(),timeoutMs=30000}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new RangeError('PowerShell probe timeout must be between 1 and 30000 milliseconds.');
  const attempts=[];
  for(const [index,command] of candidates.entries()){
    const started=now();let child;
    try{child=probe(command,['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major'],{encoding:'utf8',windowsHide:true,timeout:timeoutMs});}
    catch(error){child={error};}
    const errorCode=child.error?(errorCodes.has(child.error.code)?child.error.code:'OTHER'):null;
    const signal=child.signal?(signals.has(child.signal)?child.signal:'OTHER'):null;
    const exitCode=Number.isInteger(child.status)?child.status:null;
    const output=typeof child.stdout==='string'?child.stdout.trim():'';
    const major=/^\d{1,2}$/.test(output)?Number(output):null;
    const verdict=errorCode==='ETIMEDOUT'?'timeout':errorCode==='ENOENT'?'not-found':errorCode?'spawn-failed':signal?'interrupted':exitCode!==0?'exit-failed':major===7?'qualified':major===null?'unparseable-version':'unsupported-version';
    attempts.push({candidate:index+1,timeoutMs,elapsedMs:Math.max(0,Math.round(now()-started)),exitCode,signal,errorCode,major,verdict});
    if(verdict==='qualified')return {command,attempts};
  }
  return {command:null,attempts};
}
