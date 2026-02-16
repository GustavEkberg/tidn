import { Layer } from 'effect';
import { Db } from './services/db/live-layer';
import { Auth } from './services/auth/live-layer';
import { Email } from './services/email/live-layer';
import { S3 } from './services/s3/live-layer';
import { Telegram } from './services/telegram/live-layer';
import { Activity } from './services/activity/live-layer';

// Combined app layer
export const AppLayer = Layer.mergeAll(
  Auth.Live,
  Db.Live,
  Email.Live,
  S3.Live,
  Telegram.Live,
  Activity.Live
);
