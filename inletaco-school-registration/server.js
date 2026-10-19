const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 10000;
const ROOT = __dirname;
app.use(express.json({limit:'1mb'}));
app.use(express.static(ROOT, { extensions:['html'] }));
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized:false },
  connectionTimeoutMillis: 8000
}) : null;
let schemaReady;
async function initDb() {
  if (!pool) throw new Error('DATABASE_URL is not configured. Connect the Render PostgreSQL database in the service environment.');
  if (!schemaReady) schemaReady = pool.query(`
    CREATE TABLE IF NOT EXISTS school_registrations (
      id TEXT PRIMARY KEY,
      school_name TEXT NOT NULL,
      telephone TEXT NOT NULL,
      student_count INTEGER NOT NULL CHECK (student_count > 0),
      amount_paid NUMERIC(12,2) NOT NULL CHECK (amount_paid >= 0),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('Transfer','Cash')),
      debating TEXT NOT NULL DEFAULT 'No',
      video_submitted TEXT NOT NULL DEFAULT 'No',
      registration_date TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE school_registrations ADD COLUMN IF NOT EXISTS debating TEXT NOT NULL DEFAULT 'No';
    ALTER TABLE school_registrations ADD COLUMN IF NOT EXISTS video_submitted TEXT NOT NULL DEFAULT 'No';
    CREATE INDEX IF NOT EXISTS school_registrations_school_name_idx ON school_registrations (school_name);
    CREATE INDEX IF NOT EXISTS school_registrations_created_at_idx ON school_registrations (created_at);
  `).catch(e => { schemaReady = null; throw e; });
  await schemaReady;
}
function requireAdmin(req,res,next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(503).json({error:'ADMIN_PASSWORD is not configured on the server.'});
  if (req.get('x-admin-password') !== expected) return res.status(401).json({error:'Incorrect administrator password.'});
  next();
}
app.get('/api/health', async (req,res) => {
  try { await initDb(); await pool.query('SELECT 1'); res.json({ok:true,database:'connected'}); }
  catch(e) { res.status(503).json({ok:false,database:'unavailable',message:e.message}); }
});
app.post('/api/registrations/sync', async (req,res) => {
  try {
    await initDb();
    const rows = Array.isArray(req.body.registrations) ? req.body.registrations : [];
    if (rows.length > 100) return res.status(400).json({error:'Please sync no more than 100 records at a time.'});
    const saved = [];
    for (const r of rows) {
      if (!r || typeof r.id !== 'string' || !r.id || !r.schoolName || !r.telephone ||
          !Number.isInteger(Number(r.studentCount)) || Number(r.studentCount) < 1 ||
          !Number.isFinite(Number(r.amountPaid)) || Number(r.amountPaid) < 0 ||
          !['Transfer','Cash'].includes(r.paymentMethod)) {
        return res.status(400).json({error:'One or more registrations have invalid fields.'});
      }
      const date = new Date(r.registrationDate || Date.now());
      if (Number.isNaN(date.getTime())) return res.status(400).json({error:'Invalid registration date.'});
      const q = await pool.query(`
        INSERT INTO school_registrations (id,school_name,telephone,student_count,amount_paid,payment_method,debating,video_submitted,registration_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (id) DO NOTHING RETURNING id
      `,[r.id,String(r.schoolName).trim(),String(r.telephone).trim(),Number(r.studentCount),Number(r.amountPaid),r.paymentMethod,r.debating || 'No',r.videoSubmitted || 'No',date]);
      saved.push(r.id);
    }
    res.json({ok:true,acceptedIds:saved});
  } catch(e) { console.error('Sync failed:',e.message); res.status(503).json({error:'Could not sync registrations. They remain saved on this device. Try again when the server is available.'}); }
});
app.put('/api/registrations/:id', requireAdmin, async (req,res) => {
  try {
    await initDb();
    const r = req.body || {};
    if (!r.schoolName || !String(r.schoolName).trim() || !r.telephone || !String(r.telephone).trim() || !Number.isInteger(Number(r.studentCount)) || Number(r.studentCount) < 1 || !Number.isFinite(Number(r.amountPaid)) || Number(r.amountPaid) < 0 || !['Transfer','Cash'].includes(r.paymentMethod) || !['Yes','No'].includes(r.debating) || !['Yes','No'].includes(r.videoSubmitted)) return res.status(400).json({error:'Please provide valid values for all registration fields.'});
    const q = await pool.query("UPDATE school_registrations SET school_name=$2, telephone=$3, student_count=$4, amount_paid=$5, payment_method=$6, debating=$7, video_submitted=$8 WHERE id=$1 RETURNING id", [req.params.id, String(r.schoolName).trim(), String(r.telephone).trim(), Number(r.studentCount), Number(r.amountPaid), r.paymentMethod, r.debating, r.videoSubmitted]);
    if (!q.rowCount) return res.status(404).json({error:'Registration not found.'});
    res.json({ok:true});
  } catch(e) { console.error('Registration update failed:',e.message); res.status(503).json({error:'Could not update this registration.'}); }
});
app.put('/api/registrations/:id/self-edit', async (req,res) => {
  try {
    await initDb();
    const r = req.body || {};
    if (!r.verificationTelephone || !r.schoolName || !String(r.schoolName).trim() || !r.telephone || !String(r.telephone).trim() || !Number.isInteger(Number(r.studentCount)) || Number(r.studentCount) < 1 || !Number.isFinite(Number(r.amountPaid)) || Number(r.amountPaid) < 0 || !['Transfer','Cash'].includes(r.paymentMethod) || !['Yes','No'].includes(r.debating) || !['Yes','No'].includes(r.videoSubmitted)) return res.status(400).json({error:'Please provide valid values for all fields and the current registered telephone number.'});
    const q = await pool.query("UPDATE school_registrations SET school_name=$3, telephone=$4, student_count=$5, amount_paid=$6, payment_method=$7, debating=$8, video_submitted=$9 WHERE id=$1 AND telephone=$2 RETURNING id",
      [req.params.id, String(r.verificationTelephone).trim(), String(r.schoolName).trim(), String(r.telephone).trim(), Number(r.studentCount), Number(r.amountPaid), r.paymentMethod, r.debating, r.videoSubmitted]);
    if (!q.rowCount) return res.status(403).json({error:'Could not verify this registration. Check that you are editing the original registration on the device where it was saved, and that its registered telephone number has not changed.'});
    res.json({ok:true});
  } catch(e) { console.error('Self-edit failed:',e.message); res.status(503).json({error:'Could not update central registration. Please try again when the server is available.'}); }
});
app.get('/api/registrations', requireAdmin, async (req,res) => {
  try {
    await initDb();
    const q = await pool.query(`SELECT id,school_name AS "schoolName",telephone,student_count AS "studentCount",
      amount_paid::numeric AS "amountPaid",payment_method AS "paymentMethod",debating,video_submitted AS "videoSubmitted",registration_date AS "registrationDate",created_at AS "createdAt"
      FROM school_registrations ORDER BY created_at DESC`);
    const totals = await pool.query(`SELECT COUNT(*)::int AS schools,COALESCE(SUM(student_count),0)::int AS students,
      COALESCE(SUM(amount_paid),0)::numeric AS amount FROM school_registrations`);
    res.json({registrations:q.rows,totals:totals.rows[0]});
  } catch(e) { console.error('Admin list failed:',e.message); res.status(503).json({error:'Database unavailable. Check DATABASE_URL in Render service settings.'}); }
});
app.get('/api/export.csv', requireAdmin, async (req,res) => {
  try {
    await initDb();
    const q = await pool.query(`SELECT school_name,telephone,student_count,amount_paid,payment_method,debating,video_submitted,registration_date FROM school_registrations ORDER BY created_at DESC`);
    const esc = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
    const csv = [['School Name','Telephone','Number of Students','Amount Paid (NGN)','Payment Method','Will Debate','Debate Video Submitted','Registration Date'],...q.rows.map(r=>[r.school_name,r.telephone,r.student_count,r.amount_paid,r.payment_method,r.debating,r.video_submitted,r.registration_date])].map(row=>row.map(esc).join(',')).join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="inletaco-school-registrations.csv"');
    res.send('\ufeff'+csv);
  } catch(e) { res.status(503).json({error:'Database unavailable.'}); }
});
app.get('/sw.js', (req,res) => { res.setHeader('Service-Worker-Allowed','/'); res.sendFile(path.join(ROOT,'sw.js')); });
app.get('*', (req,res) => res.sendFile(path.join(ROOT,'index.html')));
app.listen(PORT, () => console.log('INLETACO School Registration Portal listening on '+PORT));
