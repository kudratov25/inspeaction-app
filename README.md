# Tekshiruv Nazorat — Deploy qilish yo'riqnomasi

## Lokal ishga tushirish

```bash
# 1. .env fayl yarating
cp .env.example .env
# .env ichida DATABASE_URL ni o'zgartiring

# 2. PostgreSQL lokal bo'lmasa — SQLite rejimida ishlatish uchun
# server.js dagi initDB chaqiruvidan oldin quyidagini qo'shing

# 3. Paketlarni o'rnating
npm install

# 4. Ishga tushiring
npm start
# http://localhost:3000
```

---

## Render.com ga deploy (BEPUL, 15 daqiqa)

### 1-qadam — GitHub ga yuklash
```bash
git init
git add .
git commit -m "first commit"
# GitHub da yangi repo oching: github.com/new
git remote add origin https://github.com/SIZNING/inspection-app.git
git push -u origin main
```

### 2-qadam — Render.com da database yaratish
1. render.com ga kiring (Google bilan)
2. **New → PostgreSQL** bosing
3. Nom: `inspection-db`
4. **Free plan** tanlang → **Create Database**
5. `Internal Database URL` ni nusxa oling

### 3-qadam — Render.com da server yaratish
1. **New → Web Service** bosing
2. GitHub repo ni ulang
3. Sozlamalar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. **Environment Variables** qo'shing:
   - `DATABASE_URL` = (2-qadamdagi URL)
   - `SESSION_SECRET` = (ixtiyoriy uzun matn, masalan: `myapp-secret-2026`)
   - `NODE_ENV` = `production`
5. **Create Web Service** → deploy avtomatik boshlanadi

### 4-qadam — Domenni ulash (ixtiyoriy)
1. Render.com → Settings → Custom Domains
2. `+ Add Custom Domain` → `inspection.sizningkompaniyangiz.uz`
3. DNS provayderda (namecheap/reg.uz):
   ```
   CNAME  inspection  →  yourapp.onrender.com
   ```
4. 10-30 daqiqada HTTPS avtomatik yonadi

---

## Railway.app ga deploy (alternativa)

```bash
# Railway CLI orqali
npm install -g @railway/cli
railway login
railway init
railway up
# PostgreSQL: Railway dashboard → New → Database → PostgreSQL
# DATABASE_URL avtomatik qo'shiladi
```

---

## Foydalanuvchilar

| Username   | Parol | Rol        |
|-----------|-------|------------|
| shavkat   | 1234  | Yig'uvchi  |
| husan     | 1234  | Yig'uvchi  |
| mirzohid  | 1234  | Yig'uvchi  |
| maruf     | 1234  | Yig'uvchi  |
| logistik  | 1234  | Logistika  |
| production| 1234  | Production |
| admin     | admin | Admin      |

**Admin panel** orqali yangi foydalanuvchi qo'shish: login → pastki "Foydalanuvchilar" tab.

