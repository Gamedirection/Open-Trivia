const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  const backendProxy = createProxyMiddleware({
    target: 'http://backend:5000',
    changeOrigin: true,
    ws: true,
    logLevel: 'debug',
  });

  app.use('/api', backendProxy);
  app.use('/socket.io', backendProxy);
};
