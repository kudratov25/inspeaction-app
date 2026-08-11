require('dotenv').config({ path: '/var/www/inspection-app/.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query("SELECT username, full_name, position, line FROM users ORDER BY username").then(r => {
  console.log(r.rows.map(u => `${u.username} | ${u.full_name} | ${u.position || '-'} | ${u.line}`).join('\n'));
  pool.end();
});
