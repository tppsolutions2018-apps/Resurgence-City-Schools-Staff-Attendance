const path=require('path');
const express=require('express');
const helmet=require('helmet');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');

const PORT=Number(process.env.PORT||3000);
const JWT_SECRET=String(process.env.JWT_SECRET||'');
const ADMIN_USER=String(process.env.ADMIN_USER||'admin').trim().toLowerCase();
const ADMIN_PASS=String(process.env.ADMIN_PASS||'');
const DATABASE_URL=String(process.env.DATABASE_URL||'').trim();
if(!JWT_SECRET||JWT_SECRET.length<32) throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
if(!ADMIN_PASS||ADMIN_PASS.length<8) throw new Error('ADMIN_PASS must be set and be at least 8 characters.');
if(!DATABASE_URL) throw new Error('DATABASE_URL must be set to a Render PostgreSQL connection string.');

const pool=new Pool({connectionString:DATABASE_URL,max:10,idleTimeoutMillis:30000});
const CLASSES=['KG 1','KG2','Nur 1','Nur 2','Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Jss 1','Jss 2','Jss 3','SS 1','SS 2','SS 3'];

function normalizeRole(r){const s=String(r||'').trim().toLowerCase();if(s==='teacher'||s==='staff')return 'Staff';if(s==='admin'||s==='administrator')return 'Admin';if(s==='student')return 'Student';if(s==='parent')return 'Parent';return String(r||'Staff')}
function safeUser(u){if(!u||typeof u!=='object')return null;const x={...u};delete x.password;delete x.loginPassword;delete x.staffPassword;return x}
function stripPerson(p){if(!p||typeof p!=='object')return p;const x={...p};delete x.loginPassword;delete x.staffPassword;delete x.password;return x}
function issue(user){return jwt.sign({username:user.username,role:user.role,uid:user.uid||null},JWT_SECRET,{expiresIn:'12h'})}
function auth(req,res,next){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Login required'});try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next()}catch{return res.status(401).json({error:'Session expired'})}}
function adminOnly(req,res,next){if(req.user.role!=='Admin')return res.status(403).json({error:'Admin only'});next()}
async function getSnapshot(key,def=[]){const r=await pool.query('SELECT value FROM snapshots WHERE key=$1',[key]);return r.rowCount?(r.rows[0].value??def):def}
async function saveSnapshot(key,value){await pool.query(`INSERT INTO snapshots(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[key,JSON.stringify(value)])}
async function getAllAttendance(){const r=await pool.query('SELECT payload FROM attendance ORDER BY created_at ASC');return r.rows.map(x=>x.payload)}

async function sanitizeStateFor(user){
 const people=await getSnapshot('rcs_people',[]), allUsers=await getSnapshot('rcs_users',[]);
 const assignments=await getSnapshot('rcs_assignments',[]), answers=await getSnapshot('rcs_answers',[]);
 const daily=await getSnapshot('resurgence_daily_reports',[]);
 const questions=await getSnapshot('rcs_questions',[]),comments=await getSnapshot('rcs_parent_comments',[]),results=await getSnapshot('rcs_results',[]),studentReports=await getSnapshot('rcs_student_reports',[]);
 const allAtt=await getAllAttendance();
 if(user.role==='Admin') return {rcs_people:(Array.isArray(people)?people:[]).map(stripPerson),rcs_users:(Array.isArray(allUsers)?allUsers:[]).map(safeUser),rcs_greports:await getSnapshot('rcs_greports',[]),rcs_assignments:assignments,rcs_answers:answers,rcs_att:allAtt,resurgence_daily_reports:daily};
 const uid=String(user.uid||'');
 const mine=(Array.isArray(people)?people:[]).filter(p=>p&&String(p.uid||'')===uid&&normalizeRole(p.role)===user.role).map(stripPerson);
 const myAtt=uid?(await pool.query('SELECT payload FROM attendance WHERE uid=$1 ORDER BY created_at ASC',[uid])).rows.map(x=>x.payload):[];
 const myDaily=(Array.isArray(daily)?daily:[]).filter(r=>r&&String(r.uid||'')===uid);
 if(user.role==='Parent'){ const pp=mine[0]||{}; const childUids=Array.isArray(pp.childUids)?pp.childUids.map(String):[]; const children=(Array.isArray(people)?people:[]).filter(p=>childUids.includes(String(p?.uid||''))).map(stripPerson); const childResults=(Array.isArray(results)?results:[]).filter(r=>childUids.includes(String(r.childUid||''))); const childComments=(Array.isArray(comments)?comments:[]).filter(c=>String(c.parentUid||'')===uid||childUids.includes(String(c.childUid||''))); return {rcs_people:[...mine,...children],rcs_users:(Array.isArray(allUsers)?allUsers:[]).filter(u=>u&&String(u.uid||'')===uid).map(safeUser),rcs_assignments:[],rcs_answers:[],rcs_greports:[],rcs_att:[],resurgence_daily_reports:[],rcs_questions:[],rcs_parent_comments:childComments,rcs_results:childResults,rcs_student_reports:[]}; }
 if(user.role==='Student'){
   const person=mine[0]||{};
   const cls=String(person.className||person.assignment||'');
   const visible=(Array.isArray(assignments)?assignments:[]).filter(a=>a&&(!a.className||a.className==='All Classes'||a.className===cls));
   return {rcs_people:mine,rcs_users:(Array.isArray(allUsers)?allUsers:[]).filter(u=>u&&String(u.uid||'')===uid).map(safeUser),rcs_assignments:visible,rcs_answers:(Array.isArray(answers)?answers:[]).filter(a=>String(a.studentUid||'')===uid),rcs_greports:[],rcs_att:myAtt,resurgence_daily_reports:myDaily,rcs_questions:(Array.isArray(questions)?questions:[]).filter(q=>String(q.studentUid||'')===uid),rcs_parent_comments:[],rcs_results:[],rcs_student_reports:(Array.isArray(studentReports)?studentReports:[]).filter(r=>String(r.studentUid||'')===uid)};
 }
 const staffClass=String(mine[0]?.className||''); const staffQuestions=(Array.isArray(questions)?questions:[]).filter(q=>String(q.staffUid||'')===uid||String(q.className||'')===staffClass); const staffComments=(Array.isArray(comments)?comments:[]).filter(c=>String(c.staffUid||'')===uid||String(c.staffClass||'')===staffClass); const staffResults=(Array.isArray(results)?results:[]).filter(r=>String(r.staffUid||'')===uid); const staffStudentReports=(Array.isArray(studentReports)?studentReports:[]).filter(r=>String(r.staffUid||'')===uid||String(r.className||'')===staffClass); return {rcs_people:mine,rcs_users:(Array.isArray(allUsers)?allUsers:[]).filter(u=>u&&String(u.uid||'')===uid).map(safeUser),rcs_assignments:Array.isArray(assignments)?assignments:[],rcs_answers:Array.isArray(answers)?answers:[],rcs_greports:[],rcs_att:myAtt,resurgence_daily_reports:myDaily,rcs_questions:staffQuestions,rcs_parent_comments:staffComments,rcs_results:staffResults,rcs_student_reports:staffStudentReports};
}

async function syncAuthFromUsers(users){
 const rows=Array.isArray(users)?users:[], client=await pool.connect();
 try{
  await client.query('BEGIN'); const keep=new Set();
  for(const raw of rows){if(!raw)continue;
   const username=String(raw.username||'').trim().toLowerCase(); if(!username)continue;
   const role=normalizeRole(raw.role); if(!['Admin','Staff','Student'].includes(role))continue;
   const uid=raw.uid?String(raw.uid):null, name=String(raw.name||username), active=raw.active===false?false:true;
   const existing=await client.query('SELECT password_hash FROM auth WHERE username=$1',[username]);
   let hash=existing.rowCount?existing.rows[0].password_hash:null; const pw=raw.password!=null?String(raw.password):'';
   if(pw)hash=await bcrypt.hash(pw,12); if(!hash)continue;
   await client.query(`INSERT INTO auth(username,password_hash,name,role,uid,active) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,name=EXCLUDED.name,role=EXCLUDED.role,uid=EXCLUDED.uid,active=EXCLUDED.active`,
    [username,hash,name,role,uid,active]); keep.add(username);
  }
  const existing=await client.query('SELECT username FROM auth WHERE username<>$1',[ADMIN_USER]);
  for(const row of existing.rows)if(!keep.has(row.username))await client.query('DELETE FROM auth WHERE username=$1',[row.username]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
async function upsertAttendance(rows){
 const client=await pool.connect();try{await client.query('BEGIN');
  for(const r0 of rows||[]){if(!r0)continue;const r={...r0},id=String(r._eventId||('evt-'+Date.now()+'-'+Math.random().toString(36).slice(2)));r._eventId=id;
   await client.query(`INSERT INTO attendance(event_id,uid,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(event_id) DO UPDATE SET uid=EXCLUDED.uid,payload=EXCLUDED.payload`,[id,String(r.uid||''),JSON.stringify(r)]);
  }await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
async function init(){
 await pool.query(`CREATE TABLE IF NOT EXISTS snapshots(key TEXT PRIMARY KEY,value JSONB NOT NULL)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS auth(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,uid TEXT,active BOOLEAN NOT NULL DEFAULT TRUE)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS attendance(event_id TEXT PRIMARY KEY,uid TEXT,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await pool.query(`CREATE INDEX IF NOT EXISTS attendance_uid_idx ON attendance(uid)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`);
 for(const [k,v] of [['rcs_people',[]],['rcs_users',[{name:'Administrator',username:ADMIN_USER,password:'',role:'Admin',active:true}]],['rcs_greports',[]],['resurgence_daily_reports',[]],['rcs_assignments',[]],['rcs_answers',[]],['rcs_questions',[]],['rcs_parent_comments',[]],['rcs_results',[]],['rcs_student_reports',[]]])if((await pool.query('SELECT 1 FROM snapshots WHERE key=$1',[k])).rowCount===0)await saveSnapshot(k,v);
 await pool.query(`INSERT INTO auth(username,password_hash,name,role,uid,active) VALUES($1,$2,'Administrator','Admin',NULL,TRUE)
 ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,name='Administrator',role='Admin',uid=NULL,active=TRUE`,[ADMIN_USER,await bcrypt.hash(ADMIN_PASS,12)]);
 await syncAuthFromUsers(await getSnapshot('rcs_users',[]));
 await pool.query(`UPDATE auth SET password_hash=$1,name='Administrator',role='Admin',uid=NULL,active=TRUE WHERE username=$2`,[await bcrypt.hash(ADMIN_PASS,12),ADMIN_USER]);
}
const app=express();app.set('trust proxy',1);app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'30mb'}));app.use(express.static(path.join(__dirname,'..','public')));
app.get('/api/health',async(req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'Resurgence City Schools Staff Attendance',database:'postgres',time:new Date().toISOString()})}catch(e){res.status(503).json({ok:false,error:'Database unavailable'})}});
app.post('/api/login',async(req,res)=>{try{const username=String(req.body.username||'').trim().toLowerCase(),password=String(req.body.password||'');
 const q=await pool.query('SELECT username,password_hash,name,role,uid,active FROM auth WHERE username=$1 OR uid=$1 ORDER BY CASE WHEN username=$1 THEN 0 ELSE 1 END LIMIT 1',[username]);const row=q.rowCount?q.rows[0]:null;
 if(!row||!(await bcrypt.compare(password,row.password_hash))||!row.active)return res.status(401).json({error:row&&!row.active?'Account paused':'Invalid username or password'});
 const user={username:row.username,name:row.name,role:row.role,uid:row.uid};res.json({token:issue(user),user,state:await sanitizeStateFor(user)});
 }catch(e){console.error(e);res.status(500).json({error:'Login failed'})}});
app.get('/api/state',auth,async(req,res)=>{try{res.json(await sanitizeStateFor(req.user))}catch(e){res.status(500).json({error:'Unable to load state'})}});
app.delete('/api/person/:uid',auth,adminOnly,async(req,res)=>{const uid=String(req.params.uid||'').trim();if(!uid)return res.status(400).json({error:'ID required'});const people=await getSnapshot('rcs_people',[]),users=await getSnapshot('rcs_users',[]);
 const np=people.filter(p=>String(p?.uid||'')!==uid),nu=users.filter(u=>String(u?.uid||'')!==uid);if(np.length===people.length&&nu.length===users.length)return res.status(404).json({error:'Record not found'});
 await saveSnapshot('rcs_people',np);await saveSnapshot('rcs_users',nu);await syncAuthFromUsers(nu);res.json({ok:true,state:await sanitizeStateFor(req.user)})});
app.delete('/api/staff/:uid',auth,adminOnly,async(req,res)=>{req.params.uid=String(req.params.uid);const people=await getSnapshot('rcs_people',[]),users=await getSnapshot('rcs_users',[]),uid=req.params.uid;const np=people.filter(p=>String(p?.uid||'')!==uid),nu=users.filter(u=>String(u?.uid||'')!==uid);await saveSnapshot('rcs_people',np);await saveSnapshot('rcs_users',nu);await syncAuthFromUsers(nu);res.json({ok:true,state:await sanitizeStateFor(req.user)})});
app.post('/api/snapshot/:key',auth,async(req,res)=>{try{const key=req.params.key,value=Array.isArray(req.body.value)?req.body.value:[];
 if(key==='resurgence_daily_reports'){if(req.user.role==='Admin')await saveSnapshot(key,value);else{const ex=await getSnapshot(key,[]),others=ex.filter(r=>String(r?.uid||'')!==String(req.user.uid||''));await saveSnapshot(key,others.concat(value.filter(r=>String(r?.uid||'')===String(req.user.uid||''))))}return res.json({ok:true,state:await sanitizeStateFor(req.user)})}
 if(key==='rcs_student_reports'){if(req.user.role==='Admin')await saveSnapshot(key,value);else if(req.user.role==='Student'){const ex=await getSnapshot(key,[]),mine=value.filter(r=>String(r.studentUid||'')===String(req.user.uid||''));await saveSnapshot(key,ex.filter(r=>String(r.studentUid||'')!==String(req.user.uid||'')).concat(mine))}else return res.status(403).json({error:'Student or Admin only'});return res.json({ok:true,state:await sanitizeStateFor(req.user)})}
 if(key==='rcs_questions'){if(req.user.role==='Admin')await saveSnapshot(key,value);else if(req.user.role==='Student'){const ex=await getSnapshot(key,[]),mine=value.filter(q=>String(q.studentUid||'')===String(req.user.uid||''));await saveSnapshot(key,ex.filter(q=>String(q.studentUid||'')!==String(req.user.uid||'')).concat(mine))}else if(req.user.role==='Staff'){const ex=await getSnapshot(key,[]),mine=value.filter(q=>String(q.staffUid||'')===String(req.user.uid||''));await saveSnapshot(key,ex.filter(q=>String(q.staffUid||'')!==String(q.staffUid||'')).concat(mine))}else return res.status(403).json({error:'Not allowed'});return res.json({ok:true,state:await sanitizeStateFor(req.user)})}
 if(key==='rcs_parent_comments'){if(req.user.role==='Admin')await saveSnapshot(key,value);else if(req.user.role==='Parent'){const ex=await getSnapshot(key,[]),mine=value.filter(c=>String(c.parentUid||'')===String(req.user.uid||''));await saveSnapshot(key,ex.filter(c=>String(c.parentUid||'')!==String(req.user.uid||'')).concat(mine))}else if(req.user.role==='Staff'){const ex=await getSnapshot(key,[]),mine=value.filter(c=>String(c.staffUid||'')===String(req.user.uid||''));await saveSnapshot(key,ex.filter(c=>String(c.staffUid||'')!==String(req.user.uid||'')).concat(mine))}else return res.status(403).json({error:'Not allowed'});return res.json({ok:true,state:await sanitizeStateFor(req.user)})}
 if(key==='rcs_results'){if(!['Admin','Staff'].includes(req.user.role))return res.status(403).json({error:'Staff or Admin only'});await saveSnapshot(key,value);return res.json({ok:true,state:await sanitizeStateFor(req.user)})}
 if(key==='rcs_answers'){if(!['Admin','Staff','Student'].includes(req.user.role))return res.status(403).json({error:'Not allowed'});const existing=await getSnapshot(key,[]);
  if(req.user.role==='Admin')await saveSnapshot(key,value);
  else if(req.user.role==='Student'){const mine=value.filter(a=>String(a?.studentUid||'')===String(req.user.uid||''));await saveSnapshot(key,existing.filter(a=>String(a?.studentUid||'')!==String(req.user.uid||'')).concat(mine))}
  else {const mine=value.filter(a=>String(a?.staffUid||'')===String(req.user.uid||''));await saveSnapshot(key,existing.filter(a=>String(a?.staffUid||'')!==String(req.user.uid||'')).concat(mine))}
  return res.json({ok:true,state:await sanitizeStateFor(req.user)})}
 if(key==='rcs_assignments'){if(req.user.role==='Admin')await saveSnapshot(key,value);else if(req.user.role==='Staff'){const ex=await getSnapshot(key,[]),mine=value.filter(a=>String(a?.staffUid||'')===String(req.user.uid||''));await saveSnapshot(key,ex.filter(a=>String(a?.staffUid||'')!==String(req.user.uid||'')).concat(mine))}else return res.status(403).json({error:'Staff or Admin only'});return res.json({ok:true,state:await sanitizeStateFor(req.user)})}
 if(!['rcs_people','rcs_users','rcs_greports'].includes(key)||req.user.role!=='Admin')return res.status(403).json({error:'Admin only'});
 await saveSnapshot(key,value);if(key==='rcs_users')await syncAuthFromUsers(value);res.json({ok:true,state:await sanitizeStateFor(req.user)});
 }catch(e){console.error(e);res.status(500).json({error:'Unable to save data'})}});
app.post('/api/attendance/sync',auth,async(req,res)=>{try{const incoming=Array.isArray(req.body.value)?req.body.value:[],allowed=req.user.role==='Admin'?incoming:incoming.filter(r=>String(r?.uid||'')===String(req.user.uid||''));await upsertAttendance(allowed);res.json({ok:true,state:await sanitizeStateFor(req.user)})}catch(e){res.status(500).json({error:'Unable to sync attendance'})}});
app.put('/api/attendance/:id',auth,adminOnly,async(req,res)=>{try{const id=String(req.params.id),q=await pool.query('SELECT payload FROM attendance WHERE event_id=$1',[id]);if(!q.rowCount)return res.status(404).json({error:'Attendance record not found'});const next={...q.rows[0].payload,...req.body,_eventId:id};await pool.query('UPDATE attendance SET uid=$1,payload=$2::jsonb WHERE event_id=$3',[String(next.uid||''),JSON.stringify(next),id]);res.json({ok:true,state:await sanitizeStateFor(req.user)})}catch(e){res.status(500).json({error:'Unable to edit attendance'})}});
app.delete('/api/attendance/:id',auth,adminOnly,async(req,res)=>{try{await pool.query('DELETE FROM attendance WHERE event_id=$1',[String(req.params.id)]);res.json({ok:true,state:await sanitizeStateFor(req.user)})}catch(e){res.status(500).json({error:'Unable to delete attendance'})}});
app.post('/api/import',auth,adminOnly,async(req,res)=>{try{const x=req.body||{};for(const k of ['rcs_people','rcs_users','rcs_greports','resurgence_daily_reports','rcs_assignments','rcs_answers'])if(Array.isArray(x[k]))await saveSnapshot(k,x[k]);if(Array.isArray(x.rcs_users))await syncAuthFromUsers(x.rcs_users);if(Array.isArray(x.rcs_att))await upsertAttendance(x.rcs_att);res.json({ok:true,state:await sanitizeStateFor(req.user)})}catch(e){res.status(500).json({error:'Unable to import backup'})}});
app.get('/api/export',auth,adminOnly,async(req,res)=>{try{const users=(await getSnapshot('rcs_users',[])).map(safeUser);const payload={rcs_people:await getSnapshot('rcs_people',[]),rcs_users:users,rcs_greports:await getSnapshot('rcs_greports',[]),resurgence_daily_reports:await getSnapshot('resurgence_daily_reports',[]),rcs_assignments:await getSnapshot('rcs_assignments',[]),rcs_answers:await getSnapshot('rcs_answers',[]),rcs_questions:await getSnapshot('rcs_questions',[]),rcs_parent_comments:await getSnapshot('rcs_parent_comments',[]),rcs_results:await getSnapshot('rcs_results',[]),rcs_student_reports:await getSnapshot('rcs_student_reports',[]),rcs_att:await getAllAttendance()};res.setHeader('Content-Type','application/json');res.setHeader('Content-Disposition','attachment; filename="resurgence-city-schools-backup.json"');res.send(JSON.stringify(payload,null,2))}catch(e){res.status(500).json({error:'Unable to export backup'})}});
app.use((req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
init().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Resurgence City Schools Staff Attendance running on port ${PORT}`))).catch(e=>{console.error('Startup failed',e);process.exit(1)});