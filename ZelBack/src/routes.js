const defaultService = require('./services/defaultService')
const zelidService = require('./services/zelidService')

module.exports = (app) => {
  // GET methods
  app.get('/', (req, res) => {
    defaultService.defaultResponse(req, res)
  })
  app.get('/zelid/loginphrase', (req, res) => {
    zelidService.loginPhrase(req, res)
  })
  app.get('/zelid/activeloginphrases', (req, res) => {
    zelidService.activeLoginPhrases(res)
  })
  app.get('/zelid/loggedusers', (req, res) => {
    zelidService.loggedUsers(res)
  })

  // POST methods route
  app.post('/zelid/verifylogin', (req, res) => {
    zelidService.verifyLogin(req, res)
  })

  // WebSockets
  app.ws('/ws/zelid/:loginphrase', (ws, req) => {
    zelidService.wsRespondLoginPhrase(ws, req)
  })
}
