import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import mysql, { Pool } from 'mysql2/promise';
import { createServer as createViteServer } from 'vite';
import { initialVehicles, initialBookings, initialNotifications } from './src/data';
import { Vehicle, Booking, NotificationItem, UserProfile } from './src/types';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Database connection status state
let dbPool: Pool | null = null;
let dbStatus = {
  connected: false,
  type: 'fallback', // 'mysql' or 'fallback'
  error: null as string | null,
  config: {
    host: process.env.MYSQL_HOST || '',
    port: process.env.MYSQL_PORT || '3306',
    user: process.env.MYSQL_USER || '',
    database: process.env.MYSQL_DATABASE || ''
  }
};

// In-Memory Fallback Store (Simulating Database in case MySQL is offline/unconfigured)
const fallbackStore = {
  users: [
    { id: 'student-1', name: 'นายสมเกียรติ ยอดรัก (ประธานสโมสรนักศึกษา)', email: 'student@university.ac.th', phone: '099-111-2233', role: 'student', password: 'student123' },
    { id: 'staff-1', name: 'ดร.สุดาพร พงษ์สิทธิ์ (อาจารย์ประจำคณะศึกษาศาสตร์)', email: 'staff@university.ac.th', phone: '088-777-6655', role: 'staff', password: 'staff123' },
    { id: 'admin-01', name: 'สมเกียรติ ยานยนต์ (หัวหน้างานพานพาหนะกลาง)', email: 'admin@university.ac.th', phone: '086-444-2211', role: 'admin', password: 'admin123' }
  ] as UserProfile[],
  vehicles: [...initialVehicles] as Vehicle[],
  bookings: [...initialBookings] as Booking[],
  notifications: [...initialNotifications] as NotificationItem[]
};

// --- Initialize MySQL ---
async function initDatabase() {
  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE;
  const port = parseInt(process.env.MYSQL_PORT || '3306', 10);

  if (!host || !user || !database) {
    console.log('⚠️ [Database] MySQL credentials are not fully configured in env variables. Falling back to local/in-memory store.');
    dbStatus.connected = false;
    dbStatus.type = 'fallback';
    dbStatus.error = 'MySQL credentials not configured in environment variables.';
    return;
  }

  try {
    console.log(`🔌 [Database] Connecting to MySQL at ${host}:${port}...`);
    
    // First connect without database to ensure server is accessible and create DB if needed
    const setupConnection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      connectTimeout: 5000
    });

    console.log(`🛠️ [Database] Creating database if not exists: "${database}"`);
    await setupConnection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);
    await setupConnection.end();

    // Now establish connection pool to our database
    dbPool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 5000
    });

    // Test connection
    const connection = await dbPool.getConnection();
    console.log('✅ [Database] MySQL Connection successful!');
    connection.release();

    dbStatus.connected = true;
    dbStatus.type = 'mysql';
    dbStatus.error = null;

    // Create Tables
    await createTablesIfNotExist();

  } catch (err: any) {
    console.error('❌ [Database] MySQL connection failed. Error details:', err.message);
    dbPool = null;
    dbStatus.connected = false;
    dbStatus.type = 'fallback';
    dbStatus.error = `Connection failed: ${err.message}`;
  }
}

async function createTablesIfNotExist() {
  if (!dbPool) return;

  try {
    console.log('🛠️ [Database] Checking & creating MySQL tables...');

    // 1. Users Table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        role VARCHAR(20) NOT NULL,
        email VARCHAR(100) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        password VARCHAR(100) NULL
      );
    `);

    // 2. Vehicles Table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id VARCHAR(50) PRIMARY KEY,
        modelTh VARCHAR(150) NOT NULL,
        modelEn VARCHAR(150) NOT NULL,
        plateNumber VARCHAR(50) NOT NULL,
        type VARCHAR(20) NOT NULL,
        capacity INT NOT NULL,
        status VARCHAR(20) NOT NULL,
        driverNameTh VARCHAR(100) NOT NULL,
        driverNameEn VARCHAR(100) NOT NULL,
        driverPhone VARCHAR(50) NOT NULL,
        fuelTypeTh VARCHAR(50) NOT NULL,
        fuelTypeEn VARCHAR(50) NOT NULL
      );
    `);

    // 3. Bookings Table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id VARCHAR(50) PRIMARY KEY,
        vehicleId VARCHAR(50) NOT NULL,
        userId VARCHAR(50) NOT NULL,
        userName VARCHAR(150) NOT NULL,
        userRole VARCHAR(20) NOT NULL,
        userPhone VARCHAR(50) NOT NULL,
        purpose TEXT NOT NULL,
        destination VARCHAR(255) NOT NULL,
        startDate VARCHAR(20) NOT NULL,
        endDate VARCHAR(20) NOT NULL,
        startTime VARCHAR(20) NOT NULL,
        endTime VARCHAR(20) NOT NULL,
        passengers INT NOT NULL,
        status VARCHAR(20) NOT NULL,
        notes TEXT NULL,
        createdAt VARCHAR(50) NOT NULL
      );
    `);

    // 4. Notifications Table
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(50) PRIMARY KEY,
        userId VARCHAR(50) NULL,
        titleTh VARCHAR(255) NOT NULL,
        titleEn VARCHAR(255) NOT NULL,
        messageTh TEXT NOT NULL,
        messageEn TEXT NOT NULL,
        type VARCHAR(20) NOT NULL,
        \`read\` TINYINT(1) NOT NULL DEFAULT 0,
        createdAt VARCHAR(50) NOT NULL
      );
    `);

    // Seed data if empty
    await seedDatabaseIfEmpty();

  } catch (error) {
    console.error('❌ [Database] Error creating database tables:', error);
  }
}

async function seedDatabaseIfEmpty() {
  if (!dbPool) return;

  try {
    // 1. Seed Users
    const [userRows]: any = await dbPool.query('SELECT COUNT(*) as count FROM users');
    if (userRows[0].count === 0) {
      console.log('🌱 [Database] Seeding users into MySQL...');
      for (const u of fallbackStore.users) {
        await dbPool.query(
          'INSERT INTO users (id, name, role, email, phone, password) VALUES (?, ?, ?, ?, ?, ?)',
          [u.id, u.name, u.role, u.email, u.phone, u.password || null]
        );
      }
    }

    // 2. Seed Vehicles
    const [vehicleRows]: any = await dbPool.query('SELECT COUNT(*) as count FROM vehicles');
    if (vehicleRows[0].count === 0) {
      console.log('🌱 [Database] Seeding vehicles into MySQL...');
      for (const v of fallbackStore.vehicles) {
        await dbPool.query(
          'INSERT INTO vehicles (id, modelTh, modelEn, plateNumber, type, capacity, status, driverNameTh, driverNameEn, driverPhone, fuelTypeTh, fuelTypeEn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [v.id, v.modelTh, v.modelEn, v.plateNumber, v.type, v.capacity, v.status, v.driverNameTh, v.driverNameEn, v.driverPhone, v.fuelTypeTh, v.fuelTypeEn]
        );
      }
    }

    // 3. Seed Bookings
    const [bookingRows]: any = await dbPool.query('SELECT COUNT(*) as count FROM bookings');
    if (bookingRows[0].count === 0) {
      console.log('🌱 [Database] Seeding bookings into MySQL...');
      for (const b of fallbackStore.bookings) {
        await dbPool.query(
          'INSERT INTO bookings (id, vehicleId, userId, userName, userRole, userPhone, purpose, destination, startDate, endDate, startTime, endTime, passengers, status, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [b.id, b.vehicleId, b.userId, b.userName, b.userRole, b.userPhone, b.purpose, b.destination, b.startDate, b.endDate, b.startTime, b.endTime, b.passengers, b.status, b.notes || null, b.createdAt]
        );
      }
    }

    // 4. Seed Notifications
    const [notiRows]: any = await dbPool.query('SELECT COUNT(*) as count FROM notifications');
    if (notiRows[0].count === 0) {
      console.log('🌱 [Database] Seeding notifications into MySQL...');
      for (const n of fallbackStore.notifications) {
        await dbPool.query(
          'INSERT INTO notifications (id, userId, titleTh, titleEn, messageTh, messageEn, type, \`read\`, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [n.id, n.userId || null, n.titleTh, n.titleEn, n.messageTh, n.messageEn, n.type, n.read ? 1 : 0, n.createdAt]
        );
      }
    }

    console.log('✅ [Database] Seed check completed successfully.');

  } catch (error) {
    console.error('❌ [Database] Error seeding tables:', error);
  }
}

// --- API ROUTES ---

// 1. Get Database Status
app.get('/api/db-status', (req, res) => {
  res.json(dbStatus);
});

// 2. Users Authenticate & Fetch Users
app.get('/api/users', async (req, res) => {
  try {
    if (dbPool) {
      const [rows]: any = await dbPool.query('SELECT * FROM users');
      return res.json(rows);
    }
    res.json(fallbackStore.users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const newUser: UserProfile = req.body;
    if (dbPool) {
      await dbPool.query(
        'INSERT INTO users (id, name, role, email, phone, password) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = ?, role = ?, email = ?, phone = ?, password = ?',
        [newUser.id, newUser.name, newUser.role, newUser.email, newUser.phone, newUser.password || null, newUser.name, newUser.role, newUser.email, newUser.phone, newUser.password || null]
      );
    } else {
      const idx = fallbackStore.users.findIndex(u => u.id === newUser.id);
      if (idx !== -1) {
        fallbackStore.users[idx] = newUser;
      } else {
        fallbackStore.users.push(newUser);
      }
    }
    res.json({ success: true, user: newUser });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Vehicles
app.get('/api/vehicles', async (req, res) => {
  try {
    if (dbPool) {
      const [rows]: any = await dbPool.query('SELECT * FROM vehicles');
      return res.json(rows);
    }
    res.json(fallbackStore.vehicles);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vehicles', async (req, res) => {
  try {
    const v: Vehicle = req.body;
    if (dbPool) {
      await dbPool.query(
        'INSERT INTO vehicles (id, modelTh, modelEn, plateNumber, type, capacity, status, driverNameTh, driverNameEn, driverPhone, fuelTypeTh, fuelTypeEn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE modelTh=?, modelEn=?, plateNumber=?, type=?, capacity=?, status=?, driverNameTh=?, driverNameEn=?, driverPhone=?, fuelTypeTh=?, fuelTypeEn=?',
        [v.id, v.modelTh, v.modelEn, v.plateNumber, v.type, v.capacity, v.status, v.driverNameTh, v.driverNameEn, v.driverPhone, v.fuelTypeTh, v.fuelTypeEn, v.modelTh, v.modelEn, v.plateNumber, v.type, v.capacity, v.status, v.driverNameTh, v.driverNameEn, v.driverPhone, v.fuelTypeTh, v.fuelTypeEn]
      );
    } else {
      const idx = fallbackStore.vehicles.findIndex(car => car.id === v.id);
      if (idx !== -1) {
        fallbackStore.vehicles[idx] = v;
      } else {
        fallbackStore.vehicles.push(v);
      }
    }
    res.json({ success: true, vehicle: v });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/vehicles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (dbPool) {
      await dbPool.query('DELETE FROM vehicles WHERE id = ?', [id]);
    } else {
      fallbackStore.vehicles = fallbackStore.vehicles.filter(v => v.id !== id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Bookings
app.get('/api/bookings', async (req, res) => {
  try {
    if (dbPool) {
      const [rows]: any = await dbPool.query('SELECT * FROM bookings ORDER BY createdAt DESC');
      return res.json(rows);
    }
    res.json(fallbackStore.bookings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const b: Booking = req.body;
    if (dbPool) {
      await dbPool.query(
        'INSERT INTO bookings (id, vehicleId, userId, userName, userRole, userPhone, purpose, destination, startDate, endDate, startTime, endTime, passengers, status, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status=?, notes=?',
        [b.id, b.vehicleId, b.userId, b.userName, b.userRole, b.userPhone, b.purpose, b.destination, b.startDate, b.endDate, b.startTime, b.endTime, b.passengers, b.status, b.notes || null, b.createdAt, b.status, b.notes || null]
      );
    } else {
      const idx = fallbackStore.bookings.findIndex(booking => booking.id === b.id);
      if (idx !== -1) {
        fallbackStore.bookings[idx] = b;
      } else {
        fallbackStore.bookings.unshift(b);
      }
    }
    res.json({ success: true, booking: b });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/bookings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    if (dbPool) {
      await dbPool.query('UPDATE bookings SET status = ?, notes = ? WHERE id = ?', [status, notes || null, id]);
    } else {
      const booking = fallbackStore.bookings.find(b => b.id === id);
      if (booking) {
        booking.status = status;
        if (notes !== undefined) {
          booking.notes = notes;
        }
      }
    }
    res.json({ success: true, id, status, notes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Notifications
app.get('/api/notifications', async (req, res) => {
  try {
    if (dbPool) {
      const [rows]: any = await dbPool.query('SELECT * FROM notifications ORDER BY createdAt DESC');
      // map tinynint back to boolean
      const mapped = rows.map((r: any) => ({
        ...r,
        read: r.read === 1 || r.read === true
      }));
      return res.json(mapped);
    }
    res.json(fallbackStore.notifications);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications', async (req, res) => {
  try {
    const n: NotificationItem = req.body;
    if (dbPool) {
      await dbPool.query(
        'INSERT INTO notifications (id, userId, titleTh, titleEn, messageTh, messageEn, type, \`read\`, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [n.id, n.userId || null, n.titleTh, n.titleEn, n.messageTh, n.messageEn, n.type, n.read ? 1 : 0, n.createdAt]
      );
    } else {
      fallbackStore.notifications.unshift(n);
    }
    res.json({ success: true, notification: n });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    if (dbPool) {
      await dbPool.query('UPDATE notifications SET \`read\` = 1 WHERE id = ?', [id]);
    } else {
      const noti = fallbackStore.notifications.find(n => n.id === id);
      if (noti) {
        noti.read = true;
      }
    }
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/clear', async (req, res) => {
  try {
    const { userId } = req.body;
    if (dbPool) {
      if (userId) {
        await dbPool.query('DELETE FROM notifications WHERE userId = ?', [userId]);
      } else {
        await dbPool.query('DELETE FROM notifications WHERE userId IS NULL');
      }
    } else {
      if (userId) {
        fallbackStore.notifications = fallbackStore.notifications.filter(n => n.userId !== userId);
      } else {
        fallbackStore.notifications = fallbackStore.notifications.filter(n => n.userId !== undefined);
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Initialize Server & Development Middleware ---
async function start() {
  await initDatabase();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [Server] Running at http://localhost:${PORT}`);
  });
}

start();
