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
  limits: { fileSize: 10 * 1024 * 1024 }, // Ограничение 10 МБ
  fileFilter: (req, file, cb) => {
    // Разрешённые расширения файлов
    const fileTypes = /\.(jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv)$/i;
    const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());

    // Разрешённые MIME-типы
    const mimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'application/octet-stream', // Для нестандартных клиентов
    ];
    const mimetype = mimeTypes.includes(file.mimetype);

    if (extname || mimetype) {
      console.log(`Файл принят: ${file.originalname} (${file.mimetype})`);
      return cb(null, true);
    } else {
      console.error('Неподдерживаемый тип файла:', file.originalname, file.mimetype);
      cb(new Error('Разрешены только изображения (jpg, png, gif, webp) и видео (mp4, mov, avi, mkv)'));
    }
  },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'video', maxCount: 1 },
]);

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

// Маршрут для загрузки видео
router.post('/videos/upload', authenticateToken, (req, res, next) => {
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
    console.log('Видео загружено в S3:', fileUrl);

    res.json({
      success: true,
      message: 'Видео успешно загружено',
      url: fileUrl,
    });
  } catch (error) {
    console.error('Ошибка при загрузке видео:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при загрузке видео', error: error.message });
  }
});

// Остальные маршруты (регистрация, логин, профиль, просмотр историй и т.д.) остаются без изменений
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