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
    req.user = decoded; // Предполагаем, что токен содержит id пользователя
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Недействительный токен' });
  }
};

// Регистрация (с сохранением токена)
router.post('/register', async (req, res) => {
  const { name, phone, password, serviceAgreement } = req.body;

  // Проверка обязательных полей
  if (!name || !phone || !password || !serviceAgreement) {
    return res.status(400).json({
      success: false,
      message: 'Пожалуйста, заполните все поля: имя, телефон, пароль и соглашение',
    });
  }

  try {
    // Проверка уникальности телефона
    const [existingUsers] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Этот номер телефона уже зарегистрирован',
      });
    }

    // Хеширование пароля
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Генерация JWT токена
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ phone }, JWT_SECRET, { expiresIn: '1h' }); // Токен с истечением через 1 час

    // Сохранение пользователя в базе данных с токеном
    const [result] = await pool.query(
      'INSERT INTO users (name, phone, password, token) VALUES (?, ?, ?, ?)',
      [name, phone, hashedPassword, token]
    );

    res.status(201).json({
      success: true,
      message: 'Пользователь успешно зарегистрирован',
      token: token,
      userId: result.insertId,
    });
  } catch (error) {
    console.error('Ошибка при регистрации:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при регистрации',
    });
  }
});

// Логин (возвращает новый токен)
// Логин (возвращает новый токен и user.id)
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({
      success: false,
      message: 'Пожалуйста, введите номер телефона и пароль',
    });
  }

  try {
    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь не найден',
      });
    }

    const user = users[0];
    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Неверный пароль',
      });
    }

    // Генерация нового токена при входе
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '1h' });

    // Обновление токена в базе данных
    await pool.query('UPDATE users SET token = ? WHERE id = ?', [token, user.id]);

    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      token: token,
      user: { id: user.id, phone: user.phone } // Добавляем объект user с id и phone
    });
  } catch (error) {
    console.error('Ошибка при входе:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при входе',
    });
  }
});



// Список пользователей для чатов
router.get('/users', authenticateToken, async (req, res) => {
  try {
    // Получаем всех пользователей, кроме текущего
    const [rows] = await pool.query('SELECT id, name, phone FROM users WHERE id != ?', [
      req.user.id,
    ]);
    res.json({
      success: true,
      data: rows.map((user) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        lastMessage: 'Нет сообщений', // По умолчанию, можно обновить с messages
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), // Форматированное время (HH:mm)
        unread: 0, // По умолчанию
      })),
    });
  } catch (error) {
    console.error('Ошибка получения списка пользователей:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});
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
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

module.exports = router;