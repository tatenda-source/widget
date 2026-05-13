import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { campaignsRouter } from './routes/campaigns.js';
import { donationsRouter } from './routes/donations.js';
import { webhooksRouter } from './routes/webhooks.js';

const app = express();

app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()) }));
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: true, limit: '128kb' }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    billpayMode: config.billpay.mode,
    billerCode: config.billerCode,
    currency: config.defaultCurrency,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.use('/api/campaigns', campaignsRouter);
app.use('/api/donations', donationsRouter);
app.use('/api/webhooks', webhooksRouter);

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  req.log?.error?.({ err }, 'Unhandled error');
  if (res.headersSent) return;
  res.status(500).json({
    error: 'Internal error',
    message: config.nodeEnv === 'production' ? undefined : err.message,
  });
});

app.listen(config.port, () => {
  logger.info(
    `Falcon Giving broker · ${config.billpay.mode.toUpperCase()} mode · http://localhost:${config.port}`
  );
});
