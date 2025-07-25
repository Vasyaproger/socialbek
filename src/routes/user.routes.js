const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dateFormat = require('dateformat'); // For formatting dates in /users route
const pool = require('../config/database');

// Middleware для проверки JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      throw new Error('JWT_SECRET не определён в переменных окружения');
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Токен должен содержать id и phone
    next();
  } catch (err) {
    console.error('Ошибка проверки токена:', err);
    return res.status(403).json({ success: false, message: 'Недействительный токен' });
  }
};

// Регистрация
router.post('/register', async (req, res) => {
  const { name, phone, password, serviceAgreement } = req.body;

  // Проверка обязательных полей
  if (!name || !phone || !password || !serviceAgreement) {
    return res.status(400).json({
      success: false,
      message: 'Пожалуйста, заполните все поля: имя, телефон, пароль и соглашение',
    });
  }

  // Базовая валидация телефона (например, только цифры, 10-12 символов)
  const phoneRegex = /^\d{10,12}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({
      success: false,
      message: 'Неверный формат номера телефона',
    });
  }

  // Базовая валидация пароля (например, минимум 6 символов)
  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Пароль должен содержать не менее 6 символов',
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
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Сохранение пользователя в базе данных (без хранения токена)
    const [result] = await pool.query(
      'INSERT INTO users (name, phone, password) VALUES (?, ?, ?)',
      [name, phone, hashedPassword]
    );

    // Генерация JWT токена
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      throw new Error('JWT_SECRET не определён в переменных окружения');
    }
    const token = jwt.sign({ id: result.insertId, phone }, JWT_SECRET, { expiresIn: '1h' });

    res.status(201).json({
      success: true,
      message: 'Пользователь успешно зарегистрирован',
      token,
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

// Логин
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  // Проверка обязательных полей
  if (!phone || !password) {
    return res.status(400).json({
      success: false,
      message: 'Пожалуйста, введите номер телефона и пароль',
    });
  }

  try {
    // Поиск пользователя по телефону
    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь не найден',
      });
    }

    const user = users[0];

    // Проверка пароля
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Неверный пароль',
      });
    }

    // Генерация нового токена
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      throw new Error('JWT_SECRET не определён в переменных окружения');
    }
    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '1h' });

    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      token,
    });
  } catch (error) {
    console.error('Ошибка при входе:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при входе',
    });
  }
});

// Профиль пользователя
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
    console.error('Ошибка профиля:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
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
        time: dateFormat(new Date(), 'HH:MM'), // Форматированное время
        unread: 0, // По умолчанию
      })),
    });
  } catch (error) {
    console.error('Ошибка получения списка пользователей:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

module.exports = router;