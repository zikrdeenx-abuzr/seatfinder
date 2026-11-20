const pool = require('../src/db');
(async () => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM seats');
  if (rows[0].n > 0) { console.log('Already seeded'); return pool.end(); }
  const rowsN = 6, cols = 8;
  for (let f = 1; f <= 3; f++) {
    const fl = await pool.query('INSERT INTO floors(name) VALUES($1) RETURNING id', ['Floor ' + f]);
    for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++)
      await pool.query('INSERT INTO seats(floor_id,label,x,y) VALUES($1,$2,$3,$4)',
        [fl.rows[0].id, `F${f}-${String.fromCharCode(65 + r)}${c + 1}`, c, r]);
  }
  console.log('Seeded 3 floors x 48 seats'); await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
