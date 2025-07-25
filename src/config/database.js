const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'vh438.timeweb.ru', // Добавлены кавычки
  user: 'ch79145_social',   // Добавлены кавычки
  password: 'Vasya11091109', // Добавлены кавычки
  database: 'ch79145_social', // Добавлены кавычки
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Проверяем подключение к базе данных
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Успешное подключение к базе данных MySQL');
    connection.release();
  } catch (error) {
    console.error('Ошибка подключения к базе данных:', error.message);
    process.exit(1); // Завершаем процесс при ошибке
  }
})();

module.exports = pool;