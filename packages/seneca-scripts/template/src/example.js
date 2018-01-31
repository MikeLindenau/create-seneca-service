
module.exports = function example(options) {
  const seneca = this
  const {info} = seneca.log

  seneca.add({
    role: 'example',
    cmd: 'get'
  }, get)


  function get(msg, reply) {
    info(msg, 'get actor triggered')

    reply(null, {
      ok: true,
      message: msg.name || 'world'
    })
  }
}