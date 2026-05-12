import { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from './auth';
import { createApiRouter } from './api';
import { createSlidesRouter } from './slides';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';

export function mountRoutes(app: Express, store: StateStore, auth: AuthManager): void {
  app.use(cookieParser());
  app.use('/auth', createAuthRouter(auth));
  app.use('/api/slides', createSlidesRouter(store, auth));
  app.use('/api', createApiRouter(store, auth));
}
