import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();


import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import templateRoutes from './routes/template.routes';
import datasourceRoutes from './routes/datasource.routes';
import wpRoutes from './routes/wp.routes';
import taskRoutes from './routes/task.routes';
import findingRoutes from './routes/finding.routes';
import taxonomyRoutes from './routes/taxonomy.routes';
import feedRoutes from './routes/feed.routes';
import escalationRoutes from './routes/escalation.routes';
import analyticsRoutes from './routes/analytics.routes';
import privilegeRoutes from './routes/privilege.routes';
import notificationConfigRoutes from './routes/notificationConfig.routes';
import notificationRoutes from './routes/notification.routes';
import realtimeRoutes from './routes/realtime.routes';
import referenceDataRoutes from './routes/referenceData.routes';
import attachmentRoutes from './routes/attachment.routes';
import { startRealtimeListener } from './realtime/pgEvents';
import { purgeOldNotifications } from './services/notificationService';
import { initStorage } from './services/storage';

dotenv.config();

import { prisma } from './lib/prisma';

const app = express();
const PORT = process.env.PORT || 5000;

// Auth now rides an httpOnly cookie, so CORS must allow credentials and name an
// explicit origin (a wildcard origin is incompatible with credentialed
// requests). Configure FRONTEND_ORIGIN per environment.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/datasources', datasourceRoutes);
app.use('/api/work-packages', wpRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/findings', findingRoutes);
app.use('/api/taxonomy', taxonomyRoutes);
app.use('/api/feeds', feedRoutes);
app.use('/api/escalations', escalationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings/privileges', privilegeRoutes);
app.use('/api/settings/notification-config', notificationConfigRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/events', realtimeRoutes);
app.use('/api/admin/reference-data', referenceDataRoutes);
app.use('/api/attachments', attachmentRoutes);

// Basic health check endpoint
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    // Attempt a simple database query to verify connection
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ 
      status: 'ok', 
      message: 'Aircraft Maintenance QA API is running',
      database: 'connected'
    });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Database connection failed',
      error: String(error)
    });
  }
});

// Global error handler — catches any error passed to next(err) or thrown in an
// async Express 5 route that wasn't caught by the route's own try/catch.
app.use((err: Error, req: Request, res: Response, _next: express.NextFunction) => {
  console.error('[Global error handler]', err);
  if (!res.headersSent) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Prevent unhandled promise rejections from crashing the process.
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled rejection]', reason);
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
  // Create the storage buckets / root dirs (best-effort — log and continue).
  void initStorage().catch((err) => console.error('[Storage init failed]', err));
  // Start the cross-instance realtime LISTEN bridge (never under test — Jest
  // must not hold an open DB connection past the suite).
  void startRealtimeListener();
  // Purge read notifications older than 30 days at startup then every 24 h.
  // unref() so this housekeeping timer never keeps the event loop alive on
  // shutdown (clean exit on SIGTERM/SIGINT during a deploy).
  void purgeOldNotifications(prisma);
  setInterval(() => void purgeOldNotifications(prisma), 24 * 60 * 60 * 1000).unref();
}

export default app;
