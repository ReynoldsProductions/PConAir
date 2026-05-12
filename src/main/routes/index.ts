import { Express } from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRouter } from './auth';
import { createApiRouter } from './api';
import { createSlidesRouter } from './slides';
import { createUrlRouter } from './url';
import { createOperatorRouter } from './operator';
import { createPresetsRouter } from './presets';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { PresetsStore } from '../presets';

export function mountRoutes(app: Express, store: StateStore, auth: AuthManager, presets: PresetsStore): void {
  app.use(cookieParser());
  app.use('/auth', createAuthRouter(auth));
  app.use('/operator', createOperatorRouter(auth));
  app.use('/api/slides', createSlidesRouter(store, auth));
  app.use('/api/url', createUrlRouter(store, auth));
  app.use('/api/presets', createPresetsRouter(store, auth, presets));
  app.use('/api', createApiRouter(store, auth));
}
