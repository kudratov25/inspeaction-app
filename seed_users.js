require('dotenv').config({ path: '/var/www/inspection-app/.env' });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const users = [
  // username, password, full_name, role, line
  ['0809','0809',"Li Hongxia",'admin','Departament'],
  ['0033','0033',"Ulugov Dilshodbek Bekmurod og'li",'admin','Ishlab chiqarish'],
  ['0035','0035',"Lapasov Sobirjon Bahodir ogli",'admin',"Qo'llab-quvvatlash"],

  // Payvandlash guruhi
  ['0268','0268',"Yulchiyev Sardor Soxib o'g'li",'production','Payvandlash'],
  ['0821','0821',"Liu Kai",'production','Payvandlash'],
  ['0383','0383',"Mustafoyev Abduvohid Abduxafiz o'g'li",'production','Payvandlash'],
  ['1825','1825',"Turonboyev G'iyosjon Inom O'g'li",'production','Payvandlash'],
  ['0220','0220',"Sulaymonov Javohir Asilbekovich",'production','Payvandlash'],
  ['0417','0417',"Nizomov Shaxzod Zafar o'g'li",'production','Payvandlash'],

  // Bo'yoqlash guruhi
  ['1847','1847',"To'lqinov Ilhom Dilshod o'g'li",'production',"Bo'yoqlash"],
  ['0621','0621',"Abduqayumov Abdulaziz Anvar o'g'li",'production',"Bo'yoqlash"],
  ['1996','1996',"Lin Yafang",'production',"Bo'yoqlash"],
  ['0266','0266',"Umarqulov Dilshod Norpo'latovich",'production',"Bo'yoqlash"],
  ['1331','1331',"Xu Shuai",'production',"Bo'yoqlash"],
  ['0341','0341',"Mamajonov Mardonjon Maksud o'g'li",'production',"Bo'yoqlash"],
  ['0815','0815',"Wang Fei",'production',"Bo'yoqlash"],
  ['0034','0034',"Anvarov Farrux Alisher ogli",'production',"Bo'yoqlash"],
  ['1610','1610',"Gulyamov Ayubxon Ravshan o'g'li",'production',"Bo'yoqlash"],
  ['0226','0226',"Sabirov Sardorbek Aminovich",'production',"Bo'yoqlash"],

  // O'lchov guruhi
  ['1877','1877',"Muxammadiyev Navro'zbek Elmuxammad o'g'li",'assembler',"O'lchov"],
  ['1888','1888',"Nosirov Asadbek Ulug' bek o'g'li",'assembler',"O'lchov"],
  ['1768','1768',"G'ofurov Asilbek Baxtiyor o'g'li",'assembler',"O'lchov"],
  ['0317','0317',"Bobayev Bobir Nasrullayevich",'production',"O'lchov"],
  ['0135','0135',"Kuchqorov Sanjarbek Ikrom o'g'li",'production',"O'lchov"],
  ['0155','0155',"Uskanov Shodiyor O'ktamqul o'g'li",'production',"O'lchov"],
  ['0340','0340',"Ibragimov Ilhomjon Muxtor o'g'li",'production',"O'lchov"],
  ['0032','0032',"Salimov Abdulla Ulug'bek o'g'li",'production',"O'lchov"],

  // Yig'uv guruhi
  ['1967','1967',"Ji Guanglong",'production',"Yig'uv"],
  ['1889','1889',"Nurboyev Mirzohid Shukrullo o'g'li",'production',"Yig'uv"],
  ['0619','0619',"Usmonov Moruf Avaz o'g'li",'production',"Yig'uv"],
  ['0323','0323',"Otamurodov Xusan Abdug'ani o'g'li",'production',"Yig'uv"],
  ['1314','1314',"Gong Peng",'production',"Yig'uv"],
  ['0816','0816',"Duan Nannan",'production',"Yig'uv"],
  ['0274','0274',"Narziqulov Islomjon Jaxongir o'g'li",'production',"Yig'uv"],
  ['0382','0382',"Mirzayev Shavkatjon Muxiddin o'g'li",'production',"Yig'uv"],

  // Texnik boshqaruv guruhi
  ['0158','0158',"Aliyev Izzatilla Nematulla o'g'li",'production','Texnik boshqaruv'],
  ['1917','1917',"Imomova Moxizoda Azim qizi",'production','Texnik boshqaruv'],
  ['0449','0449',"Mirzayev Shohrux Ravshan o'g'li",'production','Texnik boshqaruv'],
  ['1320','1320',"Wang Haoqiang",'production','Texnik boshqaruv'],
  ['0620','0620',"Nuriddinov Ilxomjon Nizomjon o'g'li",'production','Texnik boshqaruv'],
  ['0038','0038',"Turayev Zuxriddin Qosim ogli",'production','Texnik boshqaruv'],
];

async function main() {
  let added = 0, skipped = 0;
  for (const [username, password, full_name, role, line] of users) {
    const hash = await bcrypt.hash(password, 10);
    try {
      const result = await pool.query(
        'INSERT INTO users (username, password_hash, full_name, role, line) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO NOTHING RETURNING id',
        [username, hash, full_name, role, line]
      );
      if (result.rowCount > 0) { console.log(`OK: ${username} - ${full_name}`); added++; }
      else { console.log(`SKIP: ${username} - ${full_name} (mavjud)`); skipped++; }
    } catch(e) {
      console.error(`XATO (${username}): ${e.message}`);
    }
  }
  console.log(`\nNatija: ${added} ta qo'shildi, ${skipped} ta o'tkazib yuborildi`);
  await pool.end();
}

main().catch(console.error);
