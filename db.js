const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('assembler','logistics','production','admin')),
        line VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS records (
        id SERIAL PRIMARY KEY,
        date VARCHAR(10) NOT NULL,
        time VARCHAR(5) NOT NULL,
        line VARCHAR(20) NOT NULL,
        type VARCHAR(20) NOT NULL,
        problem TEXT NOT NULL,
        station VARCHAR(30) NOT NULL,
        auditor VARCHAR(50) NOT NULL,
        action TEXT DEFAULT '—',
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','inprogress','closed')),
        added_by VARCHAR(50) NOT NULL,
        dept VARCHAR(20) NOT NULL,
        img_before VARCHAR(255) DEFAULT '',
        img_after VARCHAR(255) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE records ADD COLUMN IF NOT EXISTS deadline DATE;
      ALTER TABLE records ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false;
      ALTER TABLE records ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(50);
    `);

    // Seed default users if table is empty
    const { rowCount } = await client.query('SELECT 1 FROM users LIMIT 1');
    if (rowCount === 0) {
      const bcrypt = require('bcryptjs');
      const users = [
        ['shavkat',    await bcrypt.hash('1234', 10),  'Shavkat T.',    'assembler',  'Trim'],
        ['husan',      await bcrypt.hash('1234', 10),  'Husan U.',      'assembler',  'Chassis'],
        ['mirzohid',   await bcrypt.hash('1234', 10),  'Mirzohid K.',   'assembler',  'Trim'],
        ['maruf',      await bcrypt.hash('1234', 10),  'Maruf B.',      'assembler',  'Final'],
        ['logistik',   await bcrypt.hash('1234', 10),  'Logistik U.',   'logistics',  'Logistika'],
        ['production', await bcrypt.hash('1234', 10),  'Production M.', 'production', 'Production'],
        ['admin',      await bcrypt.hash('admin', 10), 'Admin',         'admin',      'Boshqaruv'],
      ];
      for (const [u, h, n, r, l] of users) {
        await client.query(
          'INSERT INTO users (username, password_hash, full_name, role, line) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [u, h, n, r, l]
        );
      }

      // Seed sample records
      const sampleRecords = [
        ['27.04.26','08:30','Trim','Machine','Usage place is not shown in tool and Nm not shown.\nIshlatiladi­gan joyi yozilmagan','T-01-01','Shavkat','Pasted on tool','closed','shavkat','logistics'],
        ['28.04.26','10:15','Trim','Material','Usage place not shown, special rack kerak','T-02-01','Shavkat','Logistics begun to use special racks','closed','shavkat','logistics'],
        ['29.04.26','09:45','Trim','Material','Usage place not shown in tool','T-08-01/T-08-02','Mirzohid','Pasted on tool','closed','mirzohid','logistics'],
        ['30.04.26','11:20','Trim','Man','Operator missed to assembly (3455-00 SAP number) part','T-02-03','Shavkat','Reminded operators to install, make training for operators','closed','shavkat','production'],
        ['01.05.26','13:00','Trim','Material','No special rack for this part','T-05','Shavkat','Must be found by logistics team and must use it online','open','shavkat','logistics'],
        ['02.05.26','14:20','Chassis','Machine','Usage place not shown in tool and Nm not shown','C-02','Husan','Pasted on tool','closed','husan','logistics'],
        ['03.05.26','09:10','Chassis','Machine','Usage place not shown in tool','ET-02','Husan','Pasted on tool','closed','husan','production'],
        ['04.05.26','15:30','Final','Method','Operator did not recheck his work','F-09-01','Maruf','Reminded operators to install, make training for operators','closed','maruf','production'],
        ['14.05.26','08:55','Trim','Material','Operator used 0706-SAp number instead of 0707 SAP number','T-06','Shavkat','Reminded operators to install, make training for operators','closed','shavkat','logistics'],
      ];
      for (const r of sampleRecords) {
        await client.query(
          `INSERT INTO records (date,time,line,type,problem,station,auditor,action,status,added_by,dept)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          r
        );
      }
      console.log('✅  Database seeded with default users and records');
    }
    console.log('✅  Database initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
