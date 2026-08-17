-- Mama Maria Kindergarten Management System - Database Schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','director','teacher','parent','staff')),
  phone TEXT,
  avatar_color TEXT DEFAULT '#5B8DEF',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age_range TEXT,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  color TEXT DEFAULT '#5B8DEF',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lessons & activities created by the education director
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('lesson','activity')),
  title TEXT NOT NULL,
  description TEXT,
  objective TEXT,
  materials TEXT,
  scheduled_date TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  attachments TEXT DEFAULT '[]',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (item, class) assignment -> tracks each class/teacher's status
CREATE TABLE IF NOT EXISTS item_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','executed')),
  received_at TEXT,
  received_by INTEGER REFERENCES users(id),
  executed_at TEXT,
  executed_by INTEGER REFERENCES users(id),
  execution_notes TEXT,
  execution_photos TEXT DEFAULT '[]',
  UNIQUE(item_id, class_id)
);

-- Daily attendance: one row per (child, date), recorded by the teacher
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','absent')),
  marked_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(child_id, date)
);

-- Notes/instructions from parents (relayed by front-desk staff) about a child:
-- e.g. "give medicine at noon", "allergic to nuts", "leaves by the school bus
-- today". 'daily' notes only matter on their note_date; 'permanent' notes stay
-- visible until archived (e.g. a standing allergy).
CREATE TABLE IF NOT EXISTS parent_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL CHECK (note_type IN ('daily','permanent')),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('health','food','transport','other')),
  content TEXT NOT NULL,
  note_date TEXT,
  note_time TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  created_by INTEGER REFERENCES users(id),
  done_by INTEGER REFERENCES users(id),
  done_at TEXT,
  done_note TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- General kindergarten-wide events (holidays, trips, parent meetings,
-- celebrations...) visible to every role, unlike `items` which are
-- lessons/activities scoped to specific classes and only managed/seen by
-- staff roles.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('holiday','trip','meeting','celebration','other')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily per-child report filled by the teacher: meals, nap, mood, bathroom —
-- visible to the parent, one row per child per day.
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  meal_status TEXT CHECK (meal_status IN ('all','some','none')),
  nap_status TEXT CHECK (nap_status IN ('yes','no')),
  nap_minutes INTEGER,
  mood TEXT CHECK (mood IN ('happy','normal','tired','upset')),
  bathroom_count INTEGER,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(child_id, date)
);

-- Permanent health profile per child (blood type, allergies, chronic
-- conditions, medications, doctor info). Editable by admin/director/staff
-- and by the child's own parent; read-only for the child's teacher.
CREATE TABLE IF NOT EXISTS health_profiles (
  child_id INTEGER PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  blood_type TEXT,
  allergies TEXT,
  chronic_conditions TEXT,
  medications TEXT,
  doctor_name TEXT,
  doctor_phone TEXT,
  notes TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Emergency contacts / authorized-pickup list per child.
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relation TEXT,
  phone TEXT NOT NULL,
  can_pickup INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_date ON items(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_assignments_class ON item_assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_item ON item_assignments(item_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON attendance(class_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_child ON attendance(child_id);
CREATE INDEX IF NOT EXISTS idx_notes_class ON parent_notes(class_id, archived);
CREATE INDEX IF NOT EXISTS idx_notes_child ON parent_notes(child_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_notes_date ON parent_notes(note_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_child ON daily_reports(child_id);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_child ON emergency_contacts(child_id);
