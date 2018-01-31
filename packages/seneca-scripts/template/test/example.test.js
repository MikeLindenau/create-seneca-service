
const Code = require('code')
const Lab = require('lab')
const Seneca = require('seneca')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const expect = Code.expect


describe('example', function () {

  it('returns name or default', {timeout: 8888}, function (done) {
    Seneca()

    // Place Seneca into test mode. Errors will be passed to done callback,
    // so no need to handle them in callbacks.
    .test(done)

    // Uncomment if you want to see detailed logs
    // .test(done, 'print')
    .use('../src/example.js')

    // Insures acts are handled sync
    .gate()

    .act('role:example,cmd:hello', function (ignore, out) {
      expect(out.ok).to.be.true()
      expect(out.hello).to.equal('world')
    })

    .act('role:example,cmd:hello,name:Erlich', function (ignore, out) {
      expect(out.ok).to.be.true()
      expect(out.hello).to.equal('Erlich')
      done()
    })
  })
})
