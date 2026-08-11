require('dotenv').config({ path: '/var/www/inspection-app/.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const positions = [
  ['0809', "Direktor"],
  ['0033', "Bo'lim boshlig'i"],
  ['0035', "Bo'lim boshlig'i"],
  ['0268', "Muhandis-texnolog"],
  ['0821', "Muhandis-texnolog"],
  ['0383', "Muhandis-texnolog"],
  ['1825', "Muhandis-texnolog"],
  ['0220', "Katta muhandis-texnolog"],
  ['0417', "Muhandis-texnolog v.v.b."],
  ['1847', "Muhandis-texnolog"],
  ['0621', "Muhandis-texnolog"],
  ['1996', "Muhandis-texnolog"],
  ['0266', "Muhandis-texnolog"],
  ['1331', "Muhandis-texnolog"],
  ['0341', "Muhandis-texnolog"],
  ['0815', "Guruh boshlig'i"],
  ['0034', "Katta muhandis-texnolog"],
  ['1610', "Yetakchi muhandis-texnolog"],
  ['0226', "Yetakchi muhandis-texnolog"],
  ['1877', "O'lchov uskunasi operatori"],
  ['1888', "O'lchov uskunasi operatori"],
  ['1768', "O'lchov uskunasi operatori"],
  ['0317', "Muhandis-texnolog"],
  ['0135', "Muhandis-texnolog"],
  ['0155', "Muhandis-texnolog"],
  ['0340', "Muhandis-texnolog"],
  ['0032', "Yetakchi muhandis-texnolog"],
  ['1967', "Muhandis-texnolog"],
  ['1889', "Muhandis-texnolog"],
  ['0619', "Muhandis-texnolog"],
  ['0323', "Muhandis-texnolog"],
  ['1314', "Muhandis-texnolog"],
  ['0816', "Guruh boshlig'i"],
  ['0274', "Katta muhandis-texnolog"],
  ['0382', "Mutaxassis"],
  ['0158', "Muhandis-loyihachi"],
  ['1917', "Muhandis-loyihachi"],
  ['0449', "Muhandis-loyihachi"],
  ['1320', "Guruh boshlig'i"],
  ['0620', "Muhandis (materiallarni nazorat qilish)"],
  ['0038', "Katta muhandis-texnolog"],
];

async function main() {
  // Add column if not exists
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(100) DEFAULT ''`);
  console.log('position ustuni tayyor');

  let updated = 0;
  for (const [username, position] of positions) {
    const r = await pool.query('UPDATE users SET position=$1 WHERE username=$2', [position, username]);
    if (r.rowCount > 0) { console.log(`OK: ${username} -> ${position}`); updated++; }
    else { console.log(`SKIP: ${username} topilmadi`); }
  }
  console.log(`\nJami ${updated} ta yangilandi`);
  await pool.end();
}

main().catch(console.error);
