// Seeds the database with an initial admin account, a director, sample
// classrooms, teachers, children and parents so the app is usable immediately
// after installation. Safe to call multiple times: it only seeds when the
// users table is empty. Exported as a function so it can run automatically
// on first boot (see db/index.js) as well as from the CLI (db/seed.js).
const bcrypt = require('bcryptjs');

function seedIfEmpty(db) {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return false;

  const hash = (pwd) => bcrypt.hashSync(pwd, 10);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, phone, avatar_color)
    VALUES (@name, @email, @password_hash, @role, @phone, @avatar_color)
  `);

  insertUser.run({
    name: 'مديرة روضة ماما ماريا',
    email: 'mama.mariakids@gmail.com',
    password_hash: hash('Admin@2026'),
    role: 'admin',
    phone: '0500000000',
    avatar_color: '#B65C9E',
  });

  insertUser.run({
    name: 'أ. سارة أحمد',
    email: 'director@mamamaria.test',
    password_hash: hash('Director@123'),
    role: 'director',
    phone: '0501111111',
    avatar_color: '#4A7CE0',
  });

  const teacher1 = insertUser.run({
    name: 'أ. منى خالد',
    email: 'teacher1@mamamaria.test',
    password_hash: hash('Teacher@123'),
    role: 'teacher',
    phone: '0502222222',
    avatar_color: '#3AA0A0',
  });

  const teacher2 = insertUser.run({
    name: 'أ. ريم سالم',
    email: 'teacher2@mamamaria.test',
    password_hash: hash('Teacher@123'),
    role: 'teacher',
    phone: '0503333333',
    avatar_color: '#E0A23A',
  });

  const parent1 = insertUser.run({
    name: 'ولي أمر - أحمد محمد',
    email: 'parent1@mamamaria.test',
    password_hash: hash('Parent@123'),
    role: 'parent',
    phone: '0504444444',
    avatar_color: '#7A5CB6',
  });

  const insertClass = db.prepare(`
    INSERT INTO classes (name, age_range, teacher_id, color) VALUES (@name, @age_range, @teacher_id, @color)
  `);

  const classA = insertClass.run({
    name: 'فصل البراعم',
    age_range: '3-4 سنوات',
    teacher_id: teacher1.lastInsertRowid,
    color: '#3AA0A0',
  });

  const classB = insertClass.run({
    name: 'فصل الفراشات',
    age_range: '4-5 سنوات',
    teacher_id: teacher2.lastInsertRowid,
    color: '#E0A23A',
  });

  const insertChild = db.prepare(`
    INSERT INTO children (name, class_id, parent_id) VALUES (@name, @class_id, @parent_id)
  `);

  insertChild.run({ name: 'يوسف أحمد', class_id: classA.lastInsertRowid, parent_id: parent1.lastInsertRowid });
  insertChild.run({ name: 'لجين سالم', class_id: classB.lastInsertRowid, parent_id: null });

  return true;
}

module.exports = { seedIfEmpty };
