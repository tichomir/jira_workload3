import { Router } from 'express';
import { handleAuthorize } from '../oauth/authorize.js';
import { handleCallback } from '../oauth/tokenExchange.js';

const router = Router();

router.get('/authorize', handleAuthorize);
router.get('/callback', handleCallback);

export { router as oauthRouter };
