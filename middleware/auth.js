function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'غير مصرح',
        message: 'ليس لديك صلاحية للوصول إلى هذه الصفحة.',
        user: req.session.user,
      });
    }
    next();
  };
}

// Makes the logged-in user + unread notification count available to every view
function attachUser(db) {
  const countStmt = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0');
  return (req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.unreadCount = req.session.user ? countStmt.get(req.session.user.id).c : 0;
    res.locals.currentPath = req.path;
    next();
  };
}

module.exports = { requireLogin, requireRole, attachUser };
