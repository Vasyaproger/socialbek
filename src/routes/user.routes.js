
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
    console.error('Токен не предоставлен в запросе:', req.headers);
    return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Ошибка проверки токена:', err.message, err.stack);
    return res.status(403).json({ success: false, message: 'Недействительный токен' });
  }
};

// Настройка S3
const s3 = new AWS.S3({
  accessKeyId: process.env.S3_ACCESS_KEY_ID || 'DN1NLZTORA2L6NZ529JJ',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'iGg3syd3UiWzhoYbYlEEDSVX1HHVmWUptrBt81Y8',
  region: 'ru-1',
  endpoint: 'https://s3.twcstorage.ru',
  s3ForcePathStyle: true,
});

// Конфигурация Multer для поддержки всех форматов
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // Увеличено до 50 МБ
  fileFilter: (req, file, cb) => {
    const fileTypes = /\.(jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv|m4a|mp3|wav)$/i;
    const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
      'application/octet-stream',
    ];
    const mimetype = mimeTypes.includes(file.mimetype);

    if (extname || mimetype) {
      console.log(`Файл принят: ${file.originalname} (${file.mimetype})`);
      return cb(null, true);
    } else {
      console.error('Неподдерживаемый тип файла:', file.originalname, file.mimetype);
      cb(new Error('Разрешены только изображения (jpg, png, gif, webp), видео (mp4, mov, avi, mkv) и аудио (m4a, mp3, wav)'));
    }
  },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'video', maxCount: 1 },
]);

// Инициализация базы данных
const initializeDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Подключение к базе данных успешно');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS stories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS story_views (
        id INT AUTO_INCREMENT PRIMARY KEY,
        story_id INT NOT NULL,
        user_id INT NOT NULL,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(story_id, user_id)
      )
    `);
    console.log('Таблицы stories и story_views готовы');

    connection.release();
  } catch (err) {
    console.error('Ошибка инициализации базы данных:', err.stack);
  }
};

initializeDatabase();

// Маршрут для загрузки историй
router.post('/stories', authenticateToken, (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Ошибка Multer:', err.message, err.stack);
      return res.status(400).json({ success: false, message: `Ошибка Multer: ${err.message}` });
    } else if (err) {
      console.error('Ошибка фильтрации файла:', err.message);
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const userId = req.user.id;
    const file = req.files['file']?.[0] || req.files['image']?.[0] || req.files['video']?.[0];

    if (!file) {
      console.error('Файл не предоставлен в запросе:', req.body, req.headers);
      return res.status(400).json({ success: false, message: 'Файл не предоставлен' });
    }

    console.log('Загружаемый файл:', file.originalname, file.mimetype, file.size);

    const fileName = `${userId}/${Date.now()}${path.extname(file.originalname)}`;
    const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';

    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
    };

    const s3Response = await s3.upload(params).promise();
    const fileUrl = s3Response.Location;
    console.log('Файл загружен в S3:', fileUrl);

    const [result] = await pool.query(
      'INSERT INTO stories (user_id, file_path, timestamp) VALUES (?, ?, NOW())',
      [userId, fileUrl]
    );

    res.json({
      success: true,
      message: 'История успешно добавлена',
      fileUrl: fileUrl,
      id: result.insertId, // Возвращаем ID новой истории
    });
  } catch (error) {
    console.error('Ошибка при загрузке истории:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при загрузке истории', error: error.message });
  }
});

// Маршрут для получения историй
router.get('/stories', authenticateToken, async (req, res) => {
  try {
    const [stories] = await pool.query(`
      SELECT s.id, s.user_id, s.file_path, s.timestamp, u.name AS user_name
      FROM stories s
      JOIN users u ON s.user_id = u.id
      WHERE s.timestamp >= NOW() - INTERVAL 24 HOUR
      ORDER BY s.user_id = ? DESC, s.timestamp DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: stories
    });
  } catch (error) {
    console.error('Ошибка получения историй:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении историй', error: error.message });
  }
});

// Маршрут для регистрации просмотра истории
router.post('/stories/:id/view', authenticateToken, async (req, res) => {
  try {
    const storyId = req.params.id;
    const userId = req.user.id;

    await pool.query(
      'INSERT INTO story_views (story_id, user_id, viewed_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE viewed_at = NOW()',
      [storyId, userId]
    );

    res.json({
      success: true,
      message: 'Просмотр зарегистрирован'
    });
  } catch (error) {
    console.error('Ошибка регистрации просмотра:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации просмотра', error: error.message });
  }
});

// Маршрут для получения просмотров истории
router.get('/stories/:id/views', authenticateToken, async (req, res) => {
  try {
    const storyId = req.params.id;
    const userId = req.user.id;

    const [story] = await pool.query(
      'SELECT user_id FROM stories WHERE id = ?',
      [storyId]
    );

    if (story.length === 0) {
      return res.status(404).json({ success: false, message: 'История не найдена' });
    }

    if (story[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Доступ запрещён' });
    }

    const [views] = await pool.query(`
      SELECT u.name
      FROM story_views sv
      JOIN users u ON sv.user_id = u.id
      WHERE sv.story_id = ?
    `, [storyId]);

    res.json({
      success: true,
      data: {
        viewCount: views.length,
        viewers: views.map(view => ({ name: view.name }))
      }
    });
  } catch (error) {
    console.error('Ошибка получения просмотров:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении просмотров', error: error.message });
  }
});

// Остальные маршруты
router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, phone FROM users WHERE id != ?', [req.user.id]);
    console.log('Получены пользователи:', rows.length);
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
    console.error('Ошибка получения списка пользователей:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении списка пользователей', error: error.message });
  }
});

router.get('/user/profile', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT name, phone FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      console.error('Пользователь не найден, id:', req.user.id);
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
    console.error('Ошибка получения профиля:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении профиля', error: error.message });
  }
});

module.exports = router;
