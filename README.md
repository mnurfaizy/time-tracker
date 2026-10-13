# Time Tracker — alternatif Clockify (gratis & self-hosted)

Aplikasi web time tracking dengan tampilan dan alur kerja seperti Clockify. 100% gratis: tidak ada layanan berbayar, tidak ada batas user, dan tidak ada batas ekspor.

## Fitur

| Area | Isi |
|---|---|
| **Login & role** | Login per user (email + password, opsional "Continue with Google"). Role **Admin** dan **Member**. Orang baru bisa **Sign up** sendiri (email/password atau Google); akun aktif setelah admin klik **Approve** di menu Team. Bisa dimatikan atau dibatasi ke domain email kantor di **Settings → Sign-up**. |
| **Time Tracker** | Timer Start/Stop, mode manual, deskripsi dengan saran aktivitas terakhir, Project → Task, Tag, Billable ($). Daftar entri dikelompokkan per minggu/hari (aktivitas yang sama digabung dengan badge angka), bisa edit langsung (jam mulai/selesai, tanggal, durasi), Continue (▶), Duplicate, Delete. |
| **Calendar** | Tampilan mingguan, drag untuk membuat entri, klik untuk mengedit. Event Google Calendar ditampilkan dan bisa dijadikan time entry dengan satu klik. Admin bisa melihat kalender anggota tim. |
| **Dashboard** | Total waktu, top project/client, grafik, aktivitas terbanyak, aktivitas tim (admin). |
| **Reports** | Summary (group by 2 level + donut), Detailed (bisa diedit), Weekly. Filter Team/Client/Project/Tag/Billable/Description. Rentang tanggal bebas (hari ini sampai tahunan atau custom). |
| **Ekspor CSV** | Tanpa batas, rentang tanggal apa saja, untuk ketiga jenis report. Terbuka benar di Excel/Google Sheets. |
| **Projects/Clients/Tags** | Client, project (warna, public/private, anggota, rate per jam, billable default, catatan), task, tag. Archive/restore/delete. |
| **Team** | Admin menambah anggota, mengubah role, reset password, menonaktifkan akun. |
| **Google Calendar** | Setiap user menghubungkan akun Google masing-masing. Event tampil di Calendar, dan (opsional) setiap time entry otomatis ditulis ke Google Calendar. |

### Hak akses

| | Admin | Member |
|---|---|---|
| Track waktu sendiri | ✅ | ✅ |
| Lihat/edit waktu anggota lain, report seluruh tim | ✅ | ❌ (hanya miliknya) |
| Buat project/client/task/tag | ✅ | Bisa diizinkan di **Settings** |
| Edit/archive/hapus project, client, tag | ✅ | ❌ |
| Kelola tim & pengaturan workspace | ✅ | ❌ |
| Project private | Melihat semua | Hanya yang ia menjadi anggotanya |

## Menjalankan

Untuk mencoba di komputer sendiri. Butuh **Node.js 20.19 atau lebih baru**; database otomatis berupa file lokal, jadi tidak perlu install database. Untuk dipakai tim secara online, lihat **Deploy ke cloud gratis** di bawah.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Buka http://localhost:3000. Saat pertama dibuka, Anda diminta membuat workspace dan akun admin. Setelah itu tambahkan anggota tim di menu **Team** (password sementara otomatis disalin ke clipboard untuk dibagikan).

Untuk pengembangan (hot reload): `npm run dev`.

Konfigurasi ada di file `.env` (salin dari `.env.example`). Saat berjalan lokal, data tersimpan di folder `data/` — **backup folder ini secara berkala**.

## Google Calendar (gratis)

Cukup dilakukan sekali oleh admin:

1. Buka https://console.cloud.google.com, buat project baru.
2. **APIs & Services → Library** → aktifkan **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform). Scope yang dipakai: `openid`, `email`, `profile`, `.../auth/calendar.events`.

   > ⚠️ **PENTING — jangan biarkan status aplikasi di "Testing".**
   > Pada status *Testing*, Google memutus koneksi Calendar setiap user **setiap 7 hari**, sehingga user harus menyambungkan ulang terus. Pilih salah satu opsi di bawah agar koneksi **permanen**.

   | Kondisi tim | Pilih | Hasil |
   |---|---|---|
   | Email kantor Google Workspace (mis. `@perusahaan.com`) | User type **Internal** | Koneksi permanen, tanpa verifikasi, tanpa batas user, tanpa layar peringatan. **Paling direkomendasikan.** |
   | Akun `@gmail.com` | User type **External**, lalu tab **Audience → Publish app** sampai status menjadi **In production** | Koneksi permanen. Gratis, langsung aktif, tidak perlu menunggu review. |

   Catatan untuk opsi **External / In production** selama aplikasi belum diverifikasi Google:
   - Saat pertama kali menghubungkan akun, user melihat layar *"Google hasn't verified this app"*. Klik **Advanced → Go to … (unsafe)** untuk melanjutkan. Ini normal untuk aplikasi internal dan hanya muncul sekali per user.
   - Maksimal **100 user**.
   - Opsional: ajukan verifikasi ke Google (gratis; butuh domain sendiri dan halaman kebijakan privasi, review beberapa hari sampai minggu) untuk menghilangkan peringatan dan batas 100 user.

   Jika koneksi seorang user putus (mis. ia mencabut akses di akun Google-nya), aplikasi otomatis menandainya terputus. User cukup klik **Connect Google Calendar** lagi di Profile settings. Data time tracking tidak terpengaruh.
4. **Credentials → Create credentials → OAuth client ID** → tipe **Web application**.
   - Authorized redirect URI: `APP_URL` + `/api/google/callback`, misalnya `https://timetracker.perusahaan.com/api/google/callback` (atau `http://localhost:3000/api/google/callback` untuk lokal).
5. Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `APP_URL` di `.env`, lalu restart server.

Setelah itu tiap user membuka **Profile settings → Connect Google Calendar**. Tombol **Continue with Google** di halaman login juga aktif (hanya untuk email yang sudah didaftarkan admin).

> Google mewajibkan HTTPS untuk alamat selain `localhost`, jadi untuk dipakai tim gunakan salah satu opsi hosting di bawah.

## Deploy ke cloud gratis (tanpa kartu kredit): Render + Turso

| Bagian | Layanan | Biaya |
|---|---|---|
| Aplikasi | [Render](https://render.com) — paket Hobby/free | Rp0, tanpa kartu kredit |
| Database | [Turso](https://turso.tech) — paket Starter/free (5 GB) | Rp0, tanpa kartu kredit |
| Penjaga agar tidak "tidur" | [cron-job.org](https://cron-job.org) | Rp0 |

Hasilnya alamat HTTPS seperti `https://timetracker-xxxx.onrender.com` yang bisa dibuka seluruh tim.

### 1. Buat database di Turso
1. Login ke https://app.turso.tech → **Create Database**.
2. Nama bebas (mis. `timetracker`). **Location: AWS US West (Oregon) / `aws-us-west-2`** — harus sama dengan region Render agar aplikasi cepat.
3. Buka database tersebut, salin **URL** (diawali `libsql://…turso.io`).
4. Klik **Create Token / Generate Token** (akses *Read & Write*, tanpa kedaluwarsa), salin token-nya. Simpan baik-baik, token ini seperti password database.

### 2. Simpan kode di GitHub
Buat repository **private** di GitHub, lalu push folder ini ke sana (`node_modules`, `dist`, `data` dan `.env` otomatis tidak ikut).

### 3. Deploy di Render
1. Login ke https://dashboard.render.com (bisa pakai akun GitHub) → **New → Blueprint**.
2. Pilih repository tadi. Render membaca `render.yaml` dan menyiapkan web service gratis di region Oregon.
3. Isi environment variable yang diminta:
   - `TURSO_DATABASE_URL` → URL dari langkah 1
   - `TURSO_AUTH_TOKEN` → token dari langkah 1
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` → kosongkan dulu jika Google belum disiapkan
4. Klik **Apply**. Tunggu build selesai (±3–5 menit), lalu buka alamat `…onrender.com` dan buat workspace + akun admin.

Setiap kali kode baru di-push ke GitHub, Render otomatis deploy ulang. Data tetap aman di Turso.

### 4. Cegah aplikasi "tidur"
Render gratis mematikan aplikasi setelah 15 menit tanpa pengunjung; pembukaan berikutnya butuh ±1 menit. Agar selalu siap:
1. Daftar di https://cron-job.org → **Create cronjob**.
2. URL: `https://ALAMAT-ANDA.onrender.com/api/health`, jadwal **setiap 10 menit**.

Kuota Render 750 jam/bulan cukup untuk satu aplikasi menyala 24 jam sebulan penuh. (Cara ini umum dipakai, tapi bukan fitur resmi Render. Jika suatu saat tidak berjalan, efeknya hanya pembukaan pertama yang lambat.)

### 5. Google Calendar di Render
Ikuti bagian **Google Calendar** di atas dengan redirect URI `https://ALAMAT-ANDA.onrender.com/api/google/callback`, lalu isi `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` di Render (**Environment** → simpan → otomatis restart). `APP_URL` tidak perlu diisi di Render.

### Backup
Data ada di Turso. Untuk cadangan tambahan, admin bisa rutin ekspor **Reports → Detailed → Export CSV** untuk rentang "This year".

## Ekstensi browser (seperti Clockify)

Start/stop timer langsung dari toolbar Chrome, Edge, Brave atau Opera: deskripsi, project/task, tag, billable, daftar aktivitas terakhir (▶ untuk melanjutkan), dan ikon yang berubah biru + badge waktu saat timer berjalan.

1. Di aplikasi: **Profile settings → Browser extension → Download extension (.zip)**. ZIP ini sudah otomatis tersetel ke alamat server Anda.
2. Ekstrak ke folder yang tidak akan dihapus.
3. Buka `chrome://extensions` (Edge: `edge://extensions`) → aktifkan **Developer mode** → **Load unpacked** → pilih folder `time-tracker-extension`.
4. Pin ekstensi di toolbar lalu sign in dengan email + password. Pengguna yang login lewat Google memakai **Get sign-in code** di Profile settings.

Shortcut: **Alt+Shift+U** membuka ekstensi, **Alt+Shift+S** start/stop timer (bisa diubah di `chrome://extensions/shortcuts`).

**Dictation (tombol mic)**: ucapkan apa yang dikerjakan dan untuk project apa, misalnya *"review modul untuk project BSI AI Literacy"*. Jika project dikenali dengan yakin (nama project/klien/task, plus riwayat aktivitas Anda), timer langsung jalan. Jika tidak yakin, ekstensi menanyakan pilihan project, atau menawarkan mendaftarkan nama yang diucapkan sebagai project baru (admin, atau member bila "members can create" aktif). Speech-to-text memakai fitur bawaan Chrome/Edge (gratis, butuh internet); pemetaan project dilakukan lokal di ekstensi. Saat pertama kali dipakai, ekstensi membuka tab untuk meminta izin mikrofon sekali saja.

Kode sumber ekstensi ada di folder `extension/`. Ikon dibuat ulang dengan `node scripts/make-icons.mjs`. Jika ingin dipasang tanpa Developer mode, ekstensi bisa diunggah ke Microsoft Edge Add-ons (gratis) atau Chrome Web Store (biaya pendaftaran developer sekali bayar).

## Alternatif: jalankan di server sendiri
Tanpa `TURSO_*`, aplikasi memakai file database lokal di folder `data/`, jadi juga bisa dijalankan di PC/VM sendiri (`npm start`, atau `docker compose up -d --build`). Untuk dipakai tim dari luar kantor, dibutuhkan alamat HTTPS (mis. Cloudflare Tunnel dengan domain sendiri).

## Struktur kode

```
server/          API Express (auth, entries, reports, Google)
  routes/        satu file per resource
  lib/           Google API, sinkronisasi kalender, CSV
shared/          logika durasi & agregasi report (dipakai server dan browser)
client/src/      React UI (pages/, components/)
```
