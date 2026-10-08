const fs=require("fs");
const path=require("path");
const os=require("os");
const {execFileSync}=require("child_process");

const ROOT=process.cwd();
const INBOX=path.join(ROOT,".missions","inbox");
const RESULTS=path.join(ROOT,".missions","results");
const TOKEN=process.env.ARM_GITHUB_TOKEN||process.env.GITHUB_TOKEN||"";

function bad(message,details){const e=new Error(message);e.details=details||{};throw e}
function safePath(p){if(typeof p!=="string"||!p||path.isAbsolute(p)||p.includes("\\")||p.split("/").includes(".."))bad("Unsafe repository path: "+p);return p}
function run(cmd,args,cwd,extra={}){return execFileSync(cmd,args,{cwd,env:{...process.env,...extra},encoding:"utf8",stdio:["ignore","pipe","pipe"],maxBuffer:10*1024*1024}).trim()}
function gitEnv(token){return {GIT_CONFIG_COUNT:"1",GIT_CONFIG_KEY_0:"http.extraHeader",GIT_CONFIG_VALUE_0:"AUTHORIZATION: basic "+Buffer.from("x-access-token:"+token).toString("base64")}}
const VALID={"npm test":["npm",["test"]],"npm run build":["npm",["run","build"]],"npm run lint":["npm",["run","lint"]],"npm run typecheck":["npm",["run","typecheck"]],"pytest":["python",["-m","pytest"]],"gradle test":["./gradlew",["test"]]};
function validate(m){
 if(!m||typeof m!=="object")bad("Mission must be a JSON object.");
 if(!m.id||!/^[A-Za-z0-9._-]{1,100}$/.test(m.id))bad("Invalid mission id.");
 const t=m.target||{};
 if(!/^[A-Za-z0-9_.-]+$/.test(t.owner||"")||!/^[A-Za-z0-9_.-]+$/.test(t.repo||""))bad("target.owner and target.repo are required.");
 if(t.branch&&!/^[A-Za-z0-9._\/-]+$/.test(t.branch))bad("Unsafe target branch.");
 if(!Array.isArray(m.changes)||!m.changes.length)bad("Mission needs at least one change.");
 for(const c of m.changes){if(!c||!["create","update","delete"].includes(c.action))bad("Unsupported change action.");safePath(c.path);if(c.action!=="delete"&&typeof c.content!=="string")bad("Missing content for "+c.path)}
 if(m.validation&&!Array.isArray(m.validation))bad("validation must be an array.");
}
function applyChanges(workdir,changes){
 const applied=[];
 for(const c of changes){const rel=safePath(c.path);const full=path.resolve(workdir,rel);if(!full.startsWith(path.resolve(workdir)+path.sep))bad("Path escapes repository: "+rel);
  if(c.action==="delete"){if(fs.existsSync(full))fs.rmSync(full,{force:true})}else{fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,c.content,"utf8")}
  applied.push({action:c.action,path:rel});
 } return applied;
}
function validateWorkspace(workdir,list){
 const out=[];for(const key of list||[]){if(!VALID[key])bad("Unsupported validation command: "+key);try{const [cmd,args]=VALID[key];out.push({command:key,ok:true,output:run(cmd,args,workdir).slice(-12000)})}catch(e){out.push({command:key,ok:false,output:(e.stdout||"")+"\n"+(e.stderr||"")});bad("Validation failed: "+key,{validations:out})}}return out;
}
function processMission(file){
 const mission=JSON.parse(fs.readFileSync(file,"utf8"));validate(mission);if(!TOKEN)bad("No GitHub execution credential configured. Set ARM_GITHUB_TOKEN.");
 const t=mission.target,branch=t.branch||"main",temp=fs.mkdtempSync(path.join(os.tmpdir(),"github-arm-")),env=gitEnv(TOKEN);
 try{
  run("git",["clone","--depth","1","--branch",branch,"https://github.com/"+t.owner+"/"+t.repo+".git",temp],ROOT,env);
  const applied=applyChanges(temp,mission.changes);if(!run("git",["status","--short"],temp))bad("Mission produced no repository changes.",{applied});
  run("git",["config","user.name","GitHub Arm"],temp);run("git",["config","user.email","github-arm@users.noreply.github.com"],temp);run("git",["add","-A"],temp);
  run("git",["commit","-m",(mission.commitMessage||"Arm: "+mission.id).slice(0,180)],temp);
  const validations=validateWorkspace(temp,mission.validation||[]);run("git",["push","origin","HEAD:"+branch],temp,env);
  return {status:"succeeded",missionId:mission.id,target:t.owner+"/"+t.repo,branch,targetCommit:run("git",["rev-parse","HEAD"],temp),applied,validations,finishedAt:new Date().toISOString()};
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
}
function main(){
 fs.mkdirSync(INBOX,{recursive:true});fs.mkdirSync(RESULTS,{recursive:true});
 const files=fs.readdirSync(INBOX).filter(x=>x.endsWith(".json")).sort();if(!files.length){console.log("No pending missions.");return}
 for(const name of files){const file=path.join(INBOX,name);let result;try{result=processMission(file)}catch(e){let id=path.basename(name,".json");try{id=JSON.parse(fs.readFileSync(file,"utf8")).id||id}catch(_){}result={status:"failed",missionId:id,error:e.message,details:e.details||{},finishedAt:new Date().toISOString()};process.exitCode=1}
  fs.writeFileSync(path.join(RESULTS,result.missionId+".json"),JSON.stringify(result,null,2)+"\n");fs.rmSync(file,{force:true});console.log(JSON.stringify(result))}
}
main();
