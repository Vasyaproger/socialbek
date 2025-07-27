
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const register = async (req, res) => {
  try {
    const { name, phone, password, serviceAgreement, age, city, country, marital_status } = req.body;

    // Validate required fields
    if (!name || !phone || !password || !serviceAgreement) {
      return res.status(400).json({ success: false, message: 'Имя, телефон, пароль и согласие с условиями обязательны' });
    }

    // Validate phone format
    if (!RegExp(/^\\+[0-9]{1,3}\\d{9,12}$/).test(phone)) {
      return res.status(400).json({ success: false, message: 'Некорректный номер телефона' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Пароль должен быть минимум 6 символов' });
    }

    // Validate age (if provided)
    if (age && isNaN(parseInt(age))) {
      return res.status(400).json({ success: false, message: 'Возраст должен быть числом' });
    }

    // Validate marital status (if provided)
    if (marital_status && !['Женат/Замужем', 'Холост/Холостячка', 'В активном поиске'].includes(marital_status)) {
      return res.status(400).json({ success: false, message: 'Недопустимое семейное положение' });
    }

    // Check for existing user
    const [existingUser] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existingUser.length > 0) {
      return res.status(400).json({ success: false, message: 'Телефон уже зарегистрирован' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds); // Ошибка: bcrypt не определён

    // Insert user into database
    const [result] = await pool.query(
      'INSERT INTO users (name, phone, password, age, city, country, marital_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, phone, hashedPassword, age || null, city || null, country || null, marital_status || null]
    );

    // Generate JWT
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ id: result.insertId, phone }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      message: 'Пользователь успешно зарегистрирован',
      token,
      user: { userId: result.insertId, phone }
    });
  } catch (error) {
    console.error('Ошибка регистрации:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации', error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    // Validate required fields
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Пожалуйста, введите номер телефона и пароль',
      });
    }

    // Check for user
    const [users] = await pool.query('SELECT id, phone, password FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь не найден',
      });
    }

    const user = users[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password); // Ошибка: bcrypt не определён
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Неверный пароль',
      });
    }

    // Generate JWT
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      token,
      user: { userId: user.id, phone: user.phone }
    });
  } catch (error) {
    console.error('Ошибка при входе:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при входе',
      error: error.message
    });
  }
};

module.exports = { register, login };
