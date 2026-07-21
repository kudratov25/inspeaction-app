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
      ALTER TABLE records ADD COLUMN IF NOT EXISTS media_files TEXT DEFAULT '[]';
      ALTER TABLE records ADD COLUMN IF NOT EXISTS rating_penalized BOOLEAN DEFAULT false;
    `);

    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rating INT NOT NULL DEFAULT 100;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rating_history (
        id SERIAL PRIMARY KEY,
        month VARCHAR(7) NOT NULL,
        rank INT NOT NULL,
        username VARCHAR(50) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(20),
        line VARCHAR(50),
        rating INT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_rating_history_month ON rating_history(month);
    `);

    // Mavjud (allaqachon seedlangan) bazalar uchun: agar reyting hali umuman
    // ishlatilmagan bo'lsa (hech kim jarima olmagan, hech qanday oylik arxiv yo'q),
    // demo ballarni bir martalik qo'yib beramiz — shunda reyting bo'limi bo'sh emas ko'rinadi.
    const demoRatings = { shavkat: 100, admin: 96, mirzohid: 88, husan: 79, maruf: 65, production: 52, logistik: 35 };
    const demoUsernames = Object.keys(demoRatings);
    const { rows: histRows } = await client.query('SELECT 1 FROM rating_history LIMIT 1');
    if (histRows.length === 0) {
      const { rows: curRatings } = await client.query(
        'SELECT username, rating FROM users WHERE username = ANY($1::text[])',
        [demoUsernames]
      );
      if (curRatings.length === demoUsernames.length && curRatings.every(r => r.rating === 100)) {
        for (const [uname, val] of Object.entries(demoRatings)) {
          await client.query('UPDATE users SET rating = $1 WHERE username = $2', [val, uname]);
        }
        console.log('🏆 Namuna reytinglar qo\'yildi (bir martalik demo)');
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        text TEXT NOT NULL,
        room VARCHAR(50) DEFAULT 'umumiy',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_notifications (
        id SERIAL PRIMARY KEY,
        to_username VARCHAR(50) NOT NULL,
        record_id INTEGER,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_user ON user_notifications(to_username, is_read);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_issues (
        id SERIAL PRIMARY KEY,
        question_code VARCHAR(50),
        workshop VARCHAR(100) NOT NULL,
        line_body VARCHAR(100) NOT NULL,
        station VARCHAR(100) NOT NULL,
        problem_category VARCHAR(100),
        problem_level VARCHAR(20) DEFAULT 'Medium',
        description TEXT NOT NULL,
        discovery_dept VARCHAR(100),
        responsible_person VARCHAR(100),
        target_date DATE,
        status VARCHAR(30) DEFAULT 'open',
        progress TEXT DEFAULT '',
        corrective_action TEXT DEFAULT '',
        media_files TEXT DEFAULT '[]',
        added_by VARCHAR(50) NOT NULL,
        closed_by VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_issues(status);
      CREATE INDEX IF NOT EXISTS idx_audit_workshop ON audit_issues(workshop);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS checklist_items (
        id SERIAL PRIMARY KEY,
        category VARCHAR(150) NOT NULL,
        question TEXT NOT NULL,
        sub_label VARCHAR(100) DEFAULT '',
        order_num INT DEFAULT 0,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS checklist_responses (
        id SERIAL PRIMARY KEY,
        item_id INT REFERENCES checklist_items(id) ON DELETE CASCADE,
        response_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(10) CHECK (status IN ('ok','nok')),
        responded_by VARCHAR(50) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(item_id, response_date)
      );
      CREATE INDEX IF NOT EXISTS idx_chk_resp_date ON checklist_responses(response_date);
    `);

    const { rowCount: chkCount } = await client.query('SELECT 1 FROM checklist_items LIMIT 1');
    if (chkCount === 0) {
      const items = [
        ['WELDING — SAFETY & MACHINE', "Stud apparati parametrlari nazorat varaqasi to'ldirilganmi?", 'DA3 RF', 1],
        ['WELDING — SAFETY & MACHINE', "Operator PPE kiyganmi? (qo'lqop, ko'zoynak, kombinezon)", 'Barcha', 2],
        ['WELDING — SAFETY & MACHINE', "O't o'chirish jihozlari o'z joyidami?", 'DA-20', 3],
        ['WELDING — SAFETY & MACHINE', "Elektr kabellar va ulanmalar tekshirilganmi?", 'Barcha', 4],
        ['WELDING — SAFETY & MACHINE', "Ish joyi tozalanganmi va xavfsizlik belgilari o'rnatilganmi?", 'Barcha', 5],
        ['PAINTING', "Rinse spray nozzle vaqti to'g'ri sozlanganmi?", 'PT/ED', 6],
        ['PAINTING', 'Barcha xodimlar PPE kiyganmi?', 'Primer Sanding', 7],
        ['PAINTING', "Bo'yoq viskozitesi nazorat varag'ida yozilganmi?", 'Topcoat', 8],
        ['PAINTING', "Filtr almashtirilishi jadval bo'yicha bajarilganmi?", 'Barcha', 9],
        ['ASSEMBLY — TRIM', "Torq vositalari kalibrlangan va nazorat varaqasi to'ldirilganmi?", 'T-Line', 10],
        ['ASSEMBLY — TRIM', "Operatorlar ish ko'rsatmasini o'rganganligini tasdiqlashdimi?", 'Barcha', 11],
        ['ASSEMBLY — TRIM', "Ehtiyot qismlar soni ish rejasiga mos keladimi?", 'Logistics', 12],
        ['ASSEMBLY — FINAL', "Final tekshiruv varaqasi to'ldirilganmi?", 'QC', 13],
      ];
      for (const [cat, q, sub, ord] of items) {
        await client.query(
          'INSERT INTO checklist_items (category, question, sub_label, order_num) VALUES ($1,$2,$3,$4)',
          [cat, q, sub, ord]
        );
      }
    }

    // Seed default users if table is empty
    const { rowCount } = await client.query('SELECT 1 FROM users LIMIT 1');
    if (rowCount === 0) {
      const bcrypt = require('bcryptjs');
      const users = [
        ['shavkat',    await bcrypt.hash('1234', 10),  'Shavkat T.',    'assembler',  'Trim',       100],
        ['husan',      await bcrypt.hash('1234', 10),  'Husan U.',      'assembler',  'Chassis',    79],
        ['mirzohid',   await bcrypt.hash('1234', 10),  'Mirzohid K.',   'assembler',  'Trim',       88],
        ['maruf',      await bcrypt.hash('1234', 10),  'Maruf B.',      'assembler',  'Final',      65],
        ['logistik',   await bcrypt.hash('1234', 10),  'Logistik U.',   'logistics',  'Logistika',  35],
        ['production', await bcrypt.hash('1234', 10),  'Production M.', 'production', 'Production', 52],
        ['admin',      await bcrypt.hash('admin', 10), 'Admin',         'admin',      'Boshqaruv',  96],
      ];
      for (const [u, h, n, r, l, rating] of users) {
        await client.query(
          'INSERT INTO users (username, password_hash, full_name, role, line, rating) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
          [u, h, n, r, l, rating]
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
