
const Seneca = require('seneca')
const PinoLogAdapter = require('seneca-pino-adapter')

const serviceConfig = {
  tag: 'example_service',

  internal: {
    logger: new PinoLogAdapter({
      config: {
        level: 'info'
      }
    })
  },

  plugin: {
    mesh: {
      listen: [
        {pin:'role:example,cmd:get', model:'consume'}
      ]
    }
  }
}

const service = Seneca(serviceConfig)

service
  .use('../src/example.js')
  .use('mesh')
