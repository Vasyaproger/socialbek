const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const pool = require('../config/database');

// Middleware для проверки JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key'; // Должен быть в .env
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Недействительный токен' });
  }
};

// Регистрация и логин
router.post('/register', userController.register);
router.post('/login', userController.login);

// Профиль пользователя (защищённый маршрут)
router.get('/user/profile', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT name, phone FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    const user = rows[0];
    res.json({
      success: true,
      data: {
        name: user.name,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

module.exports = router;