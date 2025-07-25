const pool = require('../config/database');

const initUsersTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Таблица пользователей создана или уже существует');
  } catch (error) {
    console.error('Ошибка при создании таблицы пользователей:', error);
  }
};

const initMessagesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (receiver_id) REFERENCES users(id)
      )
    `);
    console.log('Таблица сообщений создана или уже существует');
  } catch (error) {
    console.error('Ошибка при создании таблицы сообщений:', error);
  }
};

const initTables = async () => {
  await initUsersTable();
  await initMessagesTable();
};

module.exports = { initTables };