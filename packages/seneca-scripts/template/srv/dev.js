
const Seneca = require('seneca')

// Service configuration which can be seen
// http://senecajs.org/api/#instance
const serviceConfig = {
  tag: 'example_service'
}

// Instantial service
const service = Seneca(serviceConfig)

service
  // Print detailed logs
  .test('print')

  // Initialize service
  .use('../src/example.js')

  // Expose service on port
  .listen(9010)