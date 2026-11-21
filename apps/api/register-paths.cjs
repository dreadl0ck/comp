const path = require('node:path');
const { register } = require('tsconfig-paths');

register({
  baseUrl: path.join(__dirname, 'dist'),
  paths: {
    '@db': ['prisma/index'],
    '@/*': ['src/*'],
  },
});
