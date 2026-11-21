// PM2 process file (VPS):  pm2 start ecosystem.config.cjs  ·  pm2 reload trust-manager
module.exports = {
  apps: [{
    name: 'trust-manager',
    cwd: __dirname,
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3000 -H 127.0.0.1',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '700M',
    env: { NODE_ENV: 'production', TZ: 'Asia/Kolkata' },
    out_file: '/var/log/trust-manager/out.log',
    error_file: '/var/log/trust-manager/error.log',
    time: true,
  }],
};
