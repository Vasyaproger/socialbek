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

// Конфигурация Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Ограничение 10 МБ
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png|mp4/;
    const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = fileTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      console.error('Неподдерживаемый тип файла:', file.originalname, file.mimetype);
      cb(new Error('Разрешены только изображения (jpg, png) и видео (mp4)'));
    }
  },
}).single('file');

// Инициализация базы данных
const initializeDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Подключение к базе данных успешно');

    // Создание таблицы users
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Таблица users готова');

    // Создание таблицы stories
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Таблица stories готова');

    // Создание таблицы story_views
    await connection.query(`
      CREATE TABLE IF NOT EXISTS story_views (
        id INT AUTO_INCREMENT PRIMARY KEY,
        story_id INT NOT NULL,
        viewer_id INT NOT NULL,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
        FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE (story_id, viewer_id)
      )
    `);
    console.log('Таблица story_views готова');

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
    const file = req.file;

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
    console.error('Ошибка при загрузке истории:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при загрузке истории', error: error.message });
  }
});

// Маршрут для получения историй
router.get('/stories', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      'SELECT id, user_id, file_path, timestamp FROM stories WHERE user_id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.json({ success: true, data: [], message: 'Истории отсутствуют' });
    }

    const stories = rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      file_path: row.file_path,
      timestamp: row.timestamp,
    }));

    res.json({ success: true, data: stories });
  } catch (error) {
    console.error('Ошибка получения историй:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении историй', error: error.message });
  }
});

// Маршрут для регистрации просмотра истории
router.post('/stories/:storyId/view', authenticateToken, async (req, res) => {
  try {
    const { storyId } = req.params;
    const viewerId = req.user.id;

    // Проверяем, существует ли история
    const [storyRows] = await pool.query('SELECT id FROM stories WHERE id = ?', [storyId]);
    if (storyRows.length === 0) {
      return res.status(404).json({ success: false, message: 'История не найдена' });
    }

    // Регистрируем просмотр (игнорируем, если уже просмотрен)
    await pool.query(
      'INSERT IGNORE INTO story_views (story_id, viewer_id) VALUES (?, ?)',
      [storyId, viewerId]
    );

    res.json({ success: true, message: 'Просмотр зарегистрирован' });
  } catch (error) {
    console.error('Ошибка регистрации просмотра:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации просмотра', error: error.message });
  }
});

// Маршрут для получения просмотров истории
router.get('/stories/:storyId/views', authenticateToken, async (req, res) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;

    // Проверяем, принадлежит ли история пользователю
    const [storyRows] = await pool.query(
      'SELECT id FROM stories WHERE id = ? AND user_id = ?',
      [storyId, userId]
    );
    if (storyRows.length === 0) {
      return res.status(403).json({ success: false, message: 'Доступ запрещён или история не найдена' });
    }

    // Получаем количество просмотров и список зрителей
    const [viewRows] = await pool.query(
      `
      SELECT u.id, u.name
      FROM story_views sv
      JOIN users u ON sv.viewer_id = u.id
      WHERE sv.story_id = ?
      `,
      [storyId]
    );

    res.json({
      success: true,
      data: {
        viewCount: viewRows.length,
        viewers: viewRows.map(row => ({
          id: row.id,
          name: row.name,
        })),
      },
    });
  } catch (error) {
    console.error('Ошибка получения просмотров:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении просмотров', error: error.message });
  }
});

// Маршрут для регистрации
router.post('/register', async (req, res) => {
  try {
    const result = await userController.register(req, res);
    if (!res.headersSent) {
      res.json(result);
    }
  } catch (error) {
    console.error('Ошибка регистрации:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации', error: error.message });
  }
});

// Маршрут для логина
router.post('/login', async (req, res) => {
  try {
    const result = await userController.login(req, res);
    if (!res.headersSent) {
      res.json(result);
    }
  } catch (error) {
    console.error('Ошибка логина:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при логине', error: error.message });
  }
});

// Список пользователей для чатов
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

// Профиль пользователя
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