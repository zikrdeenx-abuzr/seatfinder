const path = require('path');
module.exports = (app, pool) => {
  // the app screen
  app.get('/', (_q, res) => res.sendFile(path.join(__dirname, 'index.html')));

  // admin analytics: peak hours (IST) + seats that are always hogged
  app.get('/api/admin/stats', async (_q, res) => {
    try {
      const peak = await pool.query(
        `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, COUNT(*)::int AS n
         FROM events WHERE type IN ('book','checkin') GROUP BY 1 ORDER BY 1`);
      const hogged = await pool.query(
        `SELECT s.label, COUNT(*)::int AS n FROM events e JOIN seats s ON s.id = e.seat_id
         WHERE e.type = 'auto_release' GROUP BY s.label ORDER BY n DESC, s.label LIMIT 10`);
      const counts = await pool.query(`SELECT status, COUNT(*)::int AS n FROM seats GROUP BY status`);
      res.json({ peak: peak.rows, hogged: hogged.rows, counts: counts.rows });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });
};
