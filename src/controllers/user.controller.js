const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // Добавляем bcrypt
const pool = require('../config/database');

const register = async (req, res) => {
  try {
    const { name, phone, password, serviceAgreement, age, city, country, marital_status } = req.body;

    // Логируем входные данные для отладки
    console.log('Полученные данные:', { name, phone, password, serviceAgreement, age, city, country, marital_status });

    // Validate required fields
    if (!name || !phone || !password || !serviceAgreement) {
      return res.status(400).json({ success: false, message: 'Имя, телефон, пароль и согласие с условиями обязательны' });
    }

    // Очистка номера телефона
    const cleanedPhone = phone.trim().replace(/[\s()-]/g, ''); // Удаляем пробелы, скобки и дефисы
    console.log('Очищенный номер телефона:', cleanedPhone);

    // Проверка формата номера телефона
    const phoneRegex = /^\+[0-9]{1,3}[0-9]{9,15}$/;
    if (!phoneRegex.test(cleanedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Некорректный номер телефона. Используйте формат +код_страны и 9–15 цифр, например, +996505001093',
      });
    }

    // Проверка длины пароля
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Пароль должен быть минимум 6 символов' });
    }

    // Проверка возраста (если указан)
    if (age && isNaN(parseInt(age))) {
      return res.status(400).json({ success: false, message: 'Возраст должен быть числом' });
    }

    // Проверка семейного положения (если указано)
    if (marital_status && !['Женат/Замужем', 'Холост/Холостячка', 'В активном поиске'].includes(marital_status)) {
      return res.status(400).json({ success: false, message: 'Недопустимое семейное положение' });
    }

    // Проверка существующего пользователя
    const [existingUser] = await pool.query('SELECT id FROM users WHERE phone = ?', [cleanedPhone]);
    if (existingUser.length > 0) {
      return res.status(400).json({ success: false, message: 'Этот номер телефона уже зарегистрирован' });
    }

    // Хеширование пароля
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Вставка пользователя в базу данных
    const [result] = await pool.query(
      'INSERT INTO users (name, phone, password, age, city, country, marital_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, cleanedPhone, hashedPassword, age || null, city || null, country || null, marital_status || null]
    );

    // Генерация JWT
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ id: result.insertId, phone: cleanedPhone }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      message: 'Регистрация прошла успешно!',
      token,
      user: { userId: result.insertId, phone: cleanedPhone },
    });
  } catch (error) {
    console.error('Ошибка регистрации:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации', error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    // Проверка обязательных полей
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Пожалуйста, введите номер телефона и пароль',
      });
    }

    // Очистка номера телефона
    const cleanedPhone = phone.trim().replace(/[\s()-]/g, '');
    console.log('Очищенный номер телефона для входа:', cleanedPhone);

    // Проверка существования пользователя
    const [users] = await pool.query('SELECT id, phone, password FROM users WHERE phone = ?', [cleanedPhone]);
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь с таким номером телефона не найден',
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

    // Генерация JWT
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Вход выполнен успешно!',
      token,
      user: { userId: user.id, phone: user.phone },
    });
  } catch (error) {
    console.error('Ошибка при входе:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при входе',
      error: error.message,
    });
  }
};

module.exports = { register, login };