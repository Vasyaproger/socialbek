const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
  const { name, phone, password } = req.body;

  // Проверка на наличие всех обязательных полей
  if (!name || !phone || !password) {
    return res.status(400).json({ message: 'Пожалуйста, заполните все поля: имя, телефон и пароль' });
  }

  // Проверка типа данных
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ message: 'Пароль должен быть строкой и содержать минимум 6 символов' });
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
    res.status(500).json({ message: 'Произошла ошибка на сервере' });
  }
};

const login = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ message: 'Пожалуйста, заполните все поля: телефон и пароль' });
  }

  if (typeof password !== 'string') {
    return res.status(400).json({ message: 'Пароль должен быть строкой' });
  }

  try {
    const [user] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (user.length === 0) {
      return res.status(400).json({ message: 'Пользователь с таким номером телефона не найден' });
    }

    const isMatch = await bcrypt.compare(password, user[0].password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Неверный пароль' });
    }

    const token = jwt.sign(
      { id: user[0].id, phone: user[0].phone },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
  success: true,
  message: 'Вход выполнен успешно',
  token,
  user: { id: user[0].id, phone: user[0].phone } // Обернуть id и phone в объект user
});
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ message: 'Произошла ошибка на сервере' });
  }
};

module.exports = { register, login };