const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const pool = require('../config/database');
const AWS = require('aws-sdk');
const multer = require('multer');
const path = require('path');

// Middleware для проверки JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Недействительный токен' });
  }
};

// Настройка S3
const s3 = new AWS.S3({
  accessKeyId: 'DN1NLZTORA2L6NZ529JJ',
  secretAccessKey: 'iGg3syd3UiWzhoYbYlEEDSVX1HHVmWUptrBt81Y8',
  region: 'ru-1',
  endpoint: 'https://s3.twcstorage.ru', // S3 URL
  s3ForcePathStyle: true, // Для совместимости с кастомным S3
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Создание таблицы stories, если она не существует
pool.query(`
  CREATE TABLE IF NOT EXISTS stories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Маршрут для загрузки историй
router.post('/stories', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const userId = req.user.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: 'Файл не предоставлен' });
    }

    const fileName = `${userId}/${Date.now()}${path.extname(file.originalname)}`;
    const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';

    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    const s3Response = await s3.upload(params).promise();
    const fileUrl = s3Response.Location;

    await pool.query(
      'INSERT INTO stories (user_id, file_path, timestamp) VALUES (?, ?, NOW())',
      [userId, fileUrl]
    );

    res.json({
      success: true,
      message: 'История успешно добавлена',
      fileUrl: fileUrl,
    });
  } catch (error) {
    console.error('Ошибка при загрузке истории:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при загрузке истории' });
  }
});

// Используем контроллеры
router.post('/register', userController.register);
router.post('/login', userController.login);

// Список пользователей для чатов
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, phone FROM users WHERE id != ?', [req.user.id]);
    res.json({
      success: true,
      data: rows.map((user) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        lastMessage: 'Нет сообщений',
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        unread: 0,
      })),
    });
  } catch (error) {
    console.error('Ошибка получения списка пользователей:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
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
    console.error('Profile error:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

module.exports = router;