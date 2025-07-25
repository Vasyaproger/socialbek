const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
  const { name, phone, password } = req.body;

  if (!name || !phone || !password) {
    return res.status(400).json({ message: 'Заполните все поля' });
  }

  try {
    // Проверяем, существует ли пользователь с таким номером телефона
    const [existingUser] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'Пользователь с таким номером телефона уже существует' });
    }

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10);

    // Сохраняем пользователя в базе
    await pool.query('INSERT INTO users (name, phone, password) VALUES (?, ?, ?)', [name, phone, hashedPassword]);

    res.status(201).json({ message: 'Пользователь успешно зарегистрирован' });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

const login = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ message: 'Заполните все поля' });
  }

  try {
    // Ищем пользователя по номеру телефона
    const [user] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (user.length === 0) {
      return res.status(400).json({ message: 'Пользователь не найден' });
    }

    // Проверяем пароль
    const isMatch = await bcrypt.compare(password, user[0].password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Неверный пароль' });
    }

    // Создаём JWT-токен
    const token = jwt.sign(
      { id: user[0].id, phone: user[0].phone },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token, user: { id: user[0].id, name: user[0].name, phone: user[0].phone } });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

module.exports = { register, login };