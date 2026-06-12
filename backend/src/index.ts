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

dotenv.config();

import { prisma } from './lib/prisma';

const app = express();
const PORT = process.env.PORT || 3000;

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
}

export default app;
