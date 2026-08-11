require('dotenv').config({ path: '/var/www/inspection-app/.env' });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const hash = await bcrypt.hash('1320', 10);
  const r = await pool.query(
    "INSERT INTO users (username, password_hash, full_name, role, line, position) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (username) DO UPDATE SET position=$6",
    ['1320', hash, 'Wang Haoqiang', 'production', 'Texnik boshqaruv', "Guruh boshlig'i"]
  );
  console.log(r.rowCount > 0 ? "OK: 1320 - Wang Haoqiang qo'shildi/yangilandi" : "SKIP");
  await pool.end();
}
main().catch(console.error);
