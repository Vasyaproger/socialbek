const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
  const { name, phone, password, serviceAgreement } = req.body;

  if (!name || !phone || !password || !serviceAgreement) {
    return res.status(400).json({
      success: false,
      message: 'Пожалуйста, заполните все поля: имя, телефон, пароль и соглашение',
    });
  }

  try {
    const [existingUsers] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Этот номер телефона уже зарегистрирован',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ phone }, JWT_SECRET, { expiresIn: '1h' });

    const [result] = await pool.query(
      'INSERT INTO users (name, phone, password, token) VALUES (?, ?, ?, ?)',
      [name, phone, hashedPassword, token]
    );

    res.status(201).json({
      success: true,
      message: 'Пользователь успешно зарегистрирован',
      token: token,
      user: { userId: result.insertId, phone: phone } // Возвращаем user с userId
    });
  } catch (error) {
    console.error('Ошибка при регистрации:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при регистрации',
    });
  }
};

const login = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({
      success: false,
      message: 'Пожалуйста, введите номер телефона и пароль',
    });
  }

  try {
    const [users] = await pool.query('SELECT id, phone, password FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь не найден',
      });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Неверный пароль',
      });
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '1h' });

    await pool.query('UPDATE users SET token = ? WHERE id = ?', [token, user.id]);

    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      token: token,
      user: { userId: user.id, phone: user.phone } // Возвращаем user с userId
    });
  } catch (error) {
    console.error('Ошибка при входе:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при входе',
    });
  }
};

module.exports = { register, login };