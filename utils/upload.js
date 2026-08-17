const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

// Same DATA_DIR convention as db/index.js: defaults to public/uploads for
// local development, but can be pointed at a mounted persistent disk in
// production (see README "النشر" section).
const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(path.resolve(process.env.DATA_DIR), 'uploads')
  : path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9؀-ۿ_-]/g, '_')
      .slice(0, 40);
    const unique = crypto.randomBytes(6).toString('hex');
    cb(null, `${Date.now()}-${unique}-${safeBase}${ext}`);
  },
});

const ALLOWED = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.mp4', '.mp3',
]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED.has(ext)) return cb(null, true);
  cb(new Error('نوع الملف غير مدعوم'));
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024, files: 8 },
});

module.exports = upload;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
