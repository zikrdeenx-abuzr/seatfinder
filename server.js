require('dotenv').config();
const http = require('http'), crypto = require('crypto');
const express = require('express'), cors = require('cors'), { WebSocketServer } = require('ws');
const pool = require('./db');

const SECRET = process.env.TOKEN_SECRET || 'dev-secret';
const BREAK_MIN = +process.env.BREAK_MINUTES || 20;
const BOOK_MIN = +process.env.BOOK_MINUTES || 15;
const PUBLIC = 'id,floor_id,label,x,y,status,expires_at';

// ---- tiny signed token (no extra dependency) ----
const mac = p => crypto.createHmac('sha256', SECRET).update(p).digest('hex');
const sign = id => `${id}.${mac(String(id))}`;
const verify = t => {
  const [p, h] = (t || '').split('.'); if (!p || !h) return null;
  const e = mac(p);
  return h.length === e.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(e)) ? +p : null;
};
const auth = (req, res, next) => {
  const uid = verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!uid) return res.status(401).json({ error: 'Login required' });
  req.uid = uid; next();
};

const app = express(); app.use(cors()); app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---- live updates ----
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const broadcast = m => wss.clients.forEach(ws => send(ws, m));
const allSeats = async () => (await pool.query(`SELECT ${PUBLIC} FROM seats ORDER BY id`)).rows;
async function pushSeats(ids) {
  if (!ids.length) return;
  const { rows } = await pool.query(`SELECT ${PUBLIC} FROM seats WHERE id = ANY($1)`, [ids]);
  rows.forEach(seat => broadcast({ type: 'seat', seat }));
}
wss.on('connection', async ws => send(ws, { type: 'snapshot', seats: await allSeats() }));
// safety net: full snapshot every 5s, so a dropped message can never leave a stale map
setInterval(async () => { if (wss.clients.size) broadcast({ type: 'snapshot', seats: await allSeats() }); }, 5000);

// ---- auth ----
app.post('/api/login', async (req, res) => {
  const reg = String(req.body.reg_no || '').trim(), name = String(req.body.name || '').trim().slice(0, 60);
  if (!/^[A-Za-z0-9]{5,15}$/.test(reg) || !name) return res.status(400).json({ error: 'Valid registration number and name required' });
  const { rows } = await pool.query(
    `INSERT INTO users(reg_no,name) VALUES($1,$2) ON CONFLICT (reg_no) DO UPDATE SET name=EXCLUDED.name RETURNING id,reg_no,name`, [reg, name]);
  res.json({ token: sign(rows[0].id), user: rows[0] });
});

// ---- read ----
app.get('/api/floors', async (_q, res) => res.json((await pool.query('SELECT * FROM floors ORDER BY id')).rows));
app.get('/api/seats', async (_q, res) => res.json(await allSeats()));
app.get('/api/me', auth, async (req, res) => {
  const { rows } = await pool.query(`SELECT ${PUBLIC} FROM seats WHERE user_id=$1`, [req.uid]);
  res.json({ seat: rows[0] || null });
});

// ---- state changes: every one is a SINGLE atomic UPDATE guarded by the current status ----
async function act(req, res, type, sql, params, failMsg) {
  try {
    const { rows } = await pool.query(sql + ' RETURNING id', params);
    if (!rows.length) return res.status(409).json({ error: failMsg });
    await pool.query('INSERT INTO events(seat_id,user_id,type) VALUES($1,$2,$3)', [rows[0].id, req.uid, type]);
    await pushSeats([rows[0].id]);
    res.json({ ok: true, seat_id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'You already hold a seat. Release it first.' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
}
const sid = req => +req.params.id;

app.post('/api/seats/:id/book', auth, (req, res) => act(req, res, 'book',
  `UPDATE seats SET status='booked',user_id=$1,expires_at=now()+make_interval(mins=>$3),updated_at=now() WHERE id=$2 AND status='free'`,
  [req.uid, sid(req), BOOK_MIN], 'Seat is not free'));

// QR scan: free seat -> occupied (walk-in); my booked / on_break seat -> occupied
app.post('/api/seats/:id/checkin', auth, (req, res) => act(req, res, 'checkin',
  `UPDATE seats SET status='occupied',user_id=$1,expires_at=NULL,updated_at=now()
   WHERE id=$2 AND (status='free' OR (user_id=$1 AND status IN ('booked','on_break')))`,
  [req.uid, sid(req)], 'Cannot check in: seat is taken or not yours'));

app.post('/api/seats/:id/break', auth, (req, res) => act(req, res, 'break',
  `UPDATE seats SET status='on_break',expires_at=now()+make_interval(mins=>$3),updated_at=now() WHERE id=$2 AND user_id=$1 AND status='occupied'`,
  [req.uid, sid(req), BREAK_MIN], 'Seat is not yours or not occupied'));

app.post('/api/seats/:id/release', auth, (req, res) => act(req, res, 'release',
  `UPDATE seats SET status='free',user_id=NULL,expires_at=NULL,updated_at=now() WHERE id=$2 AND user_id=$1`,
  [req.uid, sid(req)], 'Seat is not yours'));

// ---- auto-release: server clock only, runs every 5s ----
async function sweep() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT id,user_id FROM seats WHERE status IN ('booked','on_break') AND expires_at < now() FOR UPDATE SKIP LOCKED`);
    if (rows.length) {
      await c.query(`UPDATE seats SET status='free',user_id=NULL,expires_at=NULL,updated_at=now() WHERE id=ANY($1)`, [rows.map(r => r.id)]);
      for (const r of rows) await c.query(`INSERT INTO events(seat_id,user_id,type) VALUES($1,$2,'auto_release')`, [r.id, r.user_id]);
    }
    await c.query('COMMIT');
    await pushSeats(rows.map(r => r.id));
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('sweep failed', e.message); }
  finally { c.release(); }
}
setInterval(sweep, 5000);

app.get('/health', (_q, res) => res.json({ ok: true }));
server.listen(process.env.PORT || 3000, () => console.log('SeatFinder on :' + (process.env.PORT || 3000)));
