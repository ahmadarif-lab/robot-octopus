/**
 * Two languages: English (default, and the text written in the source) and Indonesian.
 * Source strings are English; `t()` looks them up in ID and falls back to the key itself,
 * so a missing translation shows English instead of nothing.
 */
export const LANGS = ['en', 'id'];
const KEY = 'oc8-lang';

export const ID = {
  // Page
  'Octobot: Drivable 3D Robot Octopus': 'Octobot: Robot Gurita 3D yang Bisa Dikendarai',

  // Loader
  'LOADING GAME': 'MEMUAT PERMAINAN',
  'BUILDING THE SEABED': 'MEMBANGUN DASAR LAUT',
  'RELEASING SEA LIFE': 'MELEPAS PENGHUNI LAUT',
  'PREPARING GRAPHICS': 'MENYIAPKAN GRAFIS',
  'READY': 'SIAP',

  // Exit dialog and main menu
  'CONFIRM': 'KONFIRMASI',
  'Quit Octobot?': 'Keluar dari Octobot?',
  'Cancel': 'Batal',
  'Quit': 'Keluar',
  'You will leave the multiplayer game.': 'Kamu akan keluar dari permainan bersama.',
  'Main menu': 'Menu utama',
  'Main menu (Esc)': 'Menu utama (Esc)',
  'EXPEDITION ROBOTICS / EIGHT-ARM RIDE': 'ROBOTIKA EKSPEDISI / WAHANA DELAPAN LENGAN',
  'A robot octopus on the seabed. Explore, take it apart, and meet other players.': 'Robot gurita di dasar laut. Jelajahi, bongkar, dan temui pemain lain.',
  'Resume': 'Lanjutkan',
  'Back to the solo game': 'Kembali ke permainan sendiri',
  'Back to the multiplayer game': 'Kembali ke permainan bersama',
  'Play Solo': 'Main Sendiri',
  'Explore the sea without other players': 'Jelajahi laut tanpa pemain lain',
  'Playing now': 'Sedang dimainkan',
  'Playing now / {note}': 'Sedang dimainkan / {note}',
  'Play Together': 'Main Bersama',
  'Checking server...': 'Memeriksa server...',
  'No internet': 'Tidak ada internet',
  'Server unreachable, retrying...': 'Server tidak terjangkau, mencoba lagi...',
  '{n} players online': '{n} pemain sedang online',
  'No other players yet': 'Belum ada pemain lain',
  'Settings': 'Pengaturan',
  'Graphics, sound, language and display': 'Grafis, suara, bahasa, dan tampilan',
  'Close the game': 'Tutup permainan',
  'CHECKING': 'MEMERIKSA',
  'CHECKING SERVER': 'MEMERIKSA SERVER',
  'SERVER UP / {n} ONLINE': 'SERVER AKTIF / {n} ONLINE',
  'NO INTERNET': 'TANPA INTERNET',
  'SERVER UNREACHABLE': 'SERVER TIDAK TERJANGKAU',
  'GRAPHICS': 'GRAFIS',
  'SOUND': 'SUARA',
  'AUTO ({level})': 'OTOMATIS ({level})',
  'Octobot is a drivable 3D robot octopus that runs in the browser. Enable JavaScript and WebGL to play.': 'Octobot adalah robot gurita 3D yang bisa dikendarai di browser. Aktifkan JavaScript dan WebGL untuk memainkannya.',

  // Top bar and HUD panels
  'FLEXIBLE MANIPULATOR / FIELD SIMULATOR': 'MANIPULATOR LENTUR / SIMULATOR LAPANGAN',
  'POSITION X / Z': 'POSISI X / Z',
  'DISTANCE': 'JARAK TEMPUH',
  'TIME': 'WAKTU',
  'STATUS': 'STATUS',
  'STANDBY': 'SIAGA',
  'Mute sound': 'Matikan suara',
  'Mute sound (M)': 'Matikan suara (M)',
  'Unmute sound': 'Nyalakan suara',
  'Unmute sound (M)': 'Nyalakan suara (M)',
  'Fullscreen': 'Layar penuh',
  'Fullscreen (F)': 'Layar penuh (F)',
  'Exit fullscreen': 'Keluar dari layar penuh',
  'Exit fullscreen (F)': 'Keluar dari layar penuh (F)',
  'On iPhone: tap Share, then Add to Home Screen. Open it from its icon for fullscreen.': 'Di iPhone: ketuk Bagikan, lalu pilih Tambah ke Layar Utama. Buka dari ikonnya untuk layar penuh.',
  'The browser refused fullscreen. Try tapping the button once more.': 'Browser menolak layar penuh. Coba ketuk tombolnya sekali lagi.',
  'AI mode': 'Mode AI',
  'MOTION': 'GERAK',
  'N THRUST': 'N DORONG',
  'STEPS': 'LANGKAH',
  'GEAR': 'GIGI',
  'POWER': 'DAYA',
  '% BATTERY': '% BATERAI',
  'CURRENT': 'ARUS',
  'TEMP': 'SUHU',
  'ARM FLEX': 'TEKUKAN LENGAN',
  'DEPTH': 'KEDALAMAN',
  'HEADING': 'ARAH',
  'ASSEMBLY': 'RAKITAN',
  'LENS': 'LENSA',
  'MANTLE': 'MANTEL',
  'PUMP': 'POMPA',
  'EXPLODE ALL': 'URAI SEMUA',
  'AUTO CYCLE': 'SIKLUS OTOMATIS',
  'AI MODE': 'MODE AI',
  'DISPLAY': 'TAMPILAN',
  'LABELS': 'LABEL',
  'CONTOUR': 'KONTUR',
  'SUBSYSTEMS': 'SUBSISTEM',
  'OPTICS': 'OPTIK',
  '3 LENSES': '3 LENSA',
  'LOCKED': 'TERKUNCI',
  'OPEN': 'TERBUKA',
  'MANTLE SHELL': 'CANGKANG MANTEL',
  'SIDE HINGES': 'ENGSEL SAMPING',
  'PUMP CORE': 'INTI POMPA',
  'COILS': 'KUMPARAN',
  'SPINNING': 'BERPUTAR',
  'RAISED': 'NAIK',
  'ARM CHAIN': 'RANTAI LENGAN',
  '208 LINKS / 416 WHEELS': '208 RUAS / 416 RODA',
  'EXPLODED': 'TERURAI',
  '{n}/8 WALKING': '{n}/8 JALAN',
  'SIPHON': 'SIFON',
  'PRESS SHIFT': 'TEKAN SHIFT',
  'FIRING': 'MENYALA',
  'SCANNING': 'MEMINDAI',
  'NO CONTACT': 'TIDAK ADA KONTAK',
  'CONNECTING': 'MENYAMBUNG',
  'AWAITING COMMAND': 'MENUNGGU PERINTAH',
  'FORWARD': 'MAJU',
  'REVERSE': 'MUNDUR',
  'TURN': 'BELOK',
  'SPEED': 'KECEPATAN',
  'EXPLODE': 'URAI',
  'CLOSE': 'TUTUP',

  // Callouts on the robot
  'MAIN LENS': 'LENSA UTAMA',
  '2 INCH / HINGE': '2 INCI / ENGSEL',
  'COIL CORE': 'INTI KUMPARAN',
  'JET NOZZLE': 'NOZEL JET',
  'BEAK': 'PARUH',
  'LOWER JOINT': 'SAMBUNGAN BAWAH',

  // Drive controls
  'Forward': 'Maju',
  'Turn left': 'Belok kiri',
  'Reverse': 'Mundur',
  'Turn right': 'Belok kanan',
  'Explode': 'Urai',
  'Joystick for forward, reverse and turning': 'Joystick maju, mundur, dan belok',
  'Y, mantle and pump': 'Y, mantel dan pompa',
  'X, lens': 'X, lensa',
  'B, explode': 'B, urai',
  'A, jet': 'A, jet',
  'Online players list': 'Daftar pemain online',

  // Status line, AI and operator log
  'SYSTEM / AUTO QUALITY: {level}': 'SISTEM / KUALITAS OTOMATIS: {level}',
  'OPERATOR / READY. PRESS W TO GO FORWARD, S TO REVERSE': 'OPERATOR / SIAP. TEKAN W UNTUK MAJU, S UNTUK MUNDUR',
  'OPERATOR / LENS OPENED': 'OPERATOR / LENSA DIBUKA',
  'OPERATOR / MANTLE OPENED': 'OPERATOR / MANTEL DIBUKA',
  'OPERATOR / PUMP RAISED': 'OPERATOR / POMPA DINAIKKAN',
  'OPERATOR / ALL PARTS EXPLODED': 'OPERATOR / SELURUH BAGIAN TERURAI',
  'OPERATOR / REASSEMBLING': 'OPERATOR / PERAKITAN ULANG',
  'OPERATOR / CATCHING UP TO {name}': 'OPERATOR / MENYUSUL {name}',
  'OPERATOR / {part} {state}': 'OPERATOR / {part} {state}',
  'ACTIVE': 'AKTIF',
  'CLOSED': 'DITUTUP',
  'OPERATOR / AI OFF': 'OPERATOR / AI DIMATIKAN',
  'OPERATOR / MANUAL CONTROL TAKEN OVER': 'OPERATOR / KENDALI MANUAL DIAMBIL ALIH',
  'OPERATOR / CYCLE DONE, ALL LOCKED': 'OPERATOR / SIKLUS SELESAI, SEMUA TERKUNCI',
  'OPERATOR / SIPHON FIRED': 'OPERATOR / SIFON DINYALAKAN',
  'OPERATOR / FORWARD': 'OPERATOR / MAJU',
  'OPERATOR / REVERSE': 'OPERATOR / MUNDUR',
  'AI / {text}': 'AI / {text}',
  'AI ON, EXPLORING ON ITS OWN': 'AI AKTIF, MENJELAJAH SENDIRI',
  'CHECKING LENS': 'MEMERIKSA LENSA',
  'LOCKING LENS': 'MENGUNCI LENSA',
  'OPENING LENS': 'MEMBUKA LENSA',
  'OPENING MANTLE': 'MEMBUKA MANTEL',
  'CLOSING MANTLE': 'MENUTUP MANTEL',
  'RAISING PUMP': 'MENAIKKAN POMPA',
  'LOWERING PUMP': 'MENURUNKAN POMPA',
  'EXPLODING ALL PARTS': 'MENGURAI SEMUA BAGIAN',
  'REASSEMBLING': 'MERAKIT ULANG',
  'EXPLORING': 'MENJELAJAH',
  'APPROACHING OBJECT': 'MENDEKATI OBJEK',
  'GLIDING WITH JET': 'MELUNCUR DENGAN JET',
  'SCANNING SURROUNDINGS': 'MEMINDAI SEKITAR',
  'REVERSING': 'BERMUNDUR',
  'STOPPING FOR SERVICE': 'BERHENTI UNTUK SERVIS',

  // Driving state banner
  'JET': 'JET',
  'SIPHON / FULL THRUST': 'SIFON / DORONGAN PENUH',
  'REVERSE GAIT': 'GAYA BERJALAN TERBALIK',
  '8-ARM GAIT': 'GAYA BERJALAN 8 LENGAN',
  'TURN IN PLACE': 'PUTAR DI TEMPAT',

  // Sea life
  'BIG FISH': 'IKAN BESAR',
  'GIANT FISH': 'IKAN RAKSASA',
  'BIG SHARK': 'HIU BESAR',
  'WHALE': 'PAUS',
  'MANTA RAY': 'PARI MANTA',
  'TURTLE': 'PENYU',
  'SEAHORSE': 'KUDA LAUT',
  'JELLYFISH': 'UBUR-UBUR',
  'FISH SCHOOL': 'KAWANAN IKAN',

  // Settings and online
  'BACK': 'KEMBALI',
  'ONLINE PLAYERS': 'PEMAIN ONLINE',
  'GRAPHICS QUALITY': 'KUALITAS GRAFIS',
  'Graphics quality': 'Kualitas grafis',
  'AUTO': 'OTOMATIS',
  'HIGH': 'TINGGI',
  'MEDIUM': 'SEDANG',
  'LOW': 'RENDAH',
  'AUTO: {level}': 'OTOMATIS: {level}',
  '{status} / {fps} FPS': '{status} / {fps} FPS',
  '{status} / MEASURING FPS': '{status} / MENGUKUR FPS',
  'Auto lowers quality when the game stutters, and raises it again when it runs smoothly.': 'Otomatis menurunkan kualitas kalau permainan terasa patah-patah, dan menaikkannya lagi saat lancar.',
  'ON': 'NYALA',
  'OFF': 'MATI',
  'VOLUME': 'VOLUME',
  'PART LABELS': 'LABEL BAGIAN',
  'TERRAIN CONTOURS': 'KONTUR TANAH',
  'LANGUAGE': 'BAHASA',
  'MODE': 'MODE',
  'PLAY TOGETHER': 'MAIN BERSAMA',
  'PLAY SOLO': 'MAIN SENDIRI',
  'PLAYING SOLO': 'BERMAIN SENDIRI',
  'CONNECTING...': 'MENYAMBUNG...',
  'DISCONNECTED, RETRYING': 'TIDAK TERSAMBUNG, MENCOBA LAGI',
  '{name} / ROOM {room} / {total} ONLINE': '{name} / RUANG {room} / {total} ONLINE',
  '{total} ONLINE': '{total} ONLINE',
  'CATCH UP': 'SUSUL',
  'VERSION': 'VERSI',
  'PRIVACY POLICY': 'KEBIJAKAN PRIVASI',
  'No other players in this room yet.': 'Belum ada pemain lain di ruang ini.',

  // Loader failures (the inline script in index.html keeps its own copy of these)
  'The game failed to load. Make sure WebGL is enabled in your browser, then reload this page.': 'Permainan gagal dimuat. Pastikan WebGL aktif di browser, lalu muat ulang halaman ini.',
  'The game failed to load. Reload this page.': 'Permainan gagal dimuat. Muat ulang halaman ini.',
  'The game failed to download. Check your internet connection, then reload this page.': 'Permainan gagal diunduh. Periksa koneksi internet, lalu muat ulang halaman ini.',
};

const EN = Object.fromEntries(Object.entries(ID).map(([en, id]) => [id, en]));

let lang = 'en';
try {
  const stored = localStorage.getItem(KEY);
  if (LANGS.includes(stored)) lang = stored;
} catch {
  // Storage can be blocked; English then applies for this visit.
}

export const getLang = () => lang;

/** Translates an English source string, filling `{name}` placeholders from `vars`. */
export function t(key, vars) {
  let text = (lang === 'id' && ID[key]) || key;
  if (vars) text = text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? vars[name] : match));
  return text;
}

/** Moves already-shown text to the current language. Text with no exact translation stays as it is. */
export const retext = (text) => (lang === 'id' ? ID[text] : EN[text]) ?? text;

const TEXT_ATTRS = ['aria-label', 'title'];
const dict = () => (lang === 'id' ? ID : EN);

/** Re-translates static page text in place. Text it does not know, such as live numbers, is left alone. */
export function translateDom(root = document.body) {
  const map = dict();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const trimmed = node.nodeValue.trim();
    if (trimmed && map[trimmed]) node.nodeValue = node.nodeValue.replace(trimmed, map[trimmed]);
  }
  for (const el of root.querySelectorAll('[aria-label], [title]')) {
    for (const attr of TEXT_ATTRS) {
      const value = el.getAttribute(attr);
      if (value && map[value]) el.setAttribute(attr, map[value]);
    }
  }
}

const listeners = new Set();
export const onLangChange = (fn) => listeners.add(fn);

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // The choice then lasts for this visit only.
  }
  applyLang();
  listeners.forEach((fn) => fn(lang));
}

/** Applies the current language to the static page text and the tab title. */
export function applyLang() {
  document.documentElement.lang = lang;
  document.title = t('Octobot: Drivable 3D Robot Octopus');
  translateDom();
}
