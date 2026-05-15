module.exports = {
  apps: [
    {
      name: 'amazon-ads',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 5012 -H 0.0.0.0',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      kill_timeout: 30000,
      env: {
        NODE_ENV: 'production',
        PORT: 5012,
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
