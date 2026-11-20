const fs = require('fs'); const pool = require('../src/db');
pool.query(fs.readFileSync(__dirname + '/../db/schema.sql', 'utf8'))
  .then(() => { console.log('Schema ready'); return pool.end(); })
  .catch(e => { console.error(e); process.exit(1); });
