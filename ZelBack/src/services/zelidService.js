const mongodb = require('mongodb')
const config = require('config')
const log = require('../lib/log')
const MongoClient = mongodb.MongoClient
const mongoUrl = 'mongodb://' + config.database.url + ':' + config.database.port + '/'
const goodchars = /^[1-9a-km-zA-HJ-NP-Z]+$/
const bitcoinMessage = require('bitcoinjs-message')
const qs = require('qs')

function loginPhrase(req, res) {
  const timestamp = new Date().getTime()
  const validTill = timestamp + (15 * 60 * 1000) // 15 minutes
  const phrase = timestamp + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

  /* const activeLoginPhrases = [
     {
       loginPhrase: 1565356121335e9obp7h17bykbbvub0ts488wnnmd12fe1pq88mq0v,
       createdAt: 2019-08-09T13:08:41.335Z,
       expireAt: 2019-08-09T13:23:41.335Z
     }
] */
  MongoClient.connect(mongoUrl, function (err, db) {
    if (err) {
      log.error('Cannot reach MongoDB')
      log.error(err)
      const errMessage = {
        status: 'error',
        data: {
          message: 'Cannot reach MongoDB'
        }
      }
      return res.json(errMessage)
    }
    let dbo = db.db(config.database.local.database)
    dbo.collection(config.database.local.collections.activeLoginPhrases).createIndex({ 'createdAt': 1 }, { expireAfterSeconds: 900 })
    const newLoginPhrase = {
      loginPhrase: phrase,
      createdAt: new Date(timestamp),
      expireAt: new Date(validTill)
    }
    dbo.collection(config.database.local.collections.activeLoginPhrases).insertOne(newLoginPhrase, function (err, myres) {
      if (err) {
        log.error('Error creating new Login Phrase')
        log.error(err)
        const errMessage = {
          status: 'error',
          data: {
            message: 'Error creating new Login Phrase'
          }
        }
        return res.json(errMessage)
      } else {
        db.close()
        return res.json(phrase)
      }
    })
  })
}

function verifyLogin(req, res) {
  // Phase 2 - check that request is valid
  let body = ''
  req.on('data', function (data) {
    body += data
  })
  req.on('end', function () {
    const processedBody = qs.parse(body)
    const address = processedBody.address
    const signature = processedBody.signature
    const message = processedBody.message
    const timestamp = new Date().getTime()

    if (!goodchars.test(address)) {
      const errMessage = {
        status: 'error',
        data: {
          message: 'ZelID is not valid'
        }
      }
      return res.json(errMessage)
    }
    console.log('2')

    if (address[0] !== '1') {
      const errMessage = {
        status: 'error',
        data: {
          message: 'ZelID is not valid'
        }
      }
      return res.json(errMessage)
    }

    if (address.length > 34 || address.length < 25) {
      const errMessage = {
        status: 'error',
        data: {
          message: 'ZelID is not valid'
        }
      }
      return res.json(errMessage)
    }

    // First Check that this message is valid - has not old timestamp, is at least 40 chars and was generated by us (is stored in our db)
    if (address === undefined || address === '') {
      const errMessage = {
        status: 'error',
        data: {
          message: 'No ZelID is specified'
        }
      }
      return res.json(errMessage)
    }

    if (message === undefined || message === '') {
      const errMessage = {
        status: 'error',
        data: {
          message: 'No message is specified'
        }
      }
      return res.json(errMessage)
    }

    if (message.length < 40) {
      const errMessage = {
        status: 'error',
        data: {
          message: 'Signed message is not valid'
        }
      }
      return res.json(errMessage)
    }

    if (message.substring(0, 13) < (timestamp - 900000) || message.substring(0, 13) > timestamp) {
      const errMessage = {
        status: 'error',
        data: {
          message: 'Signed message is not valid'
        }
      }
      return res.json(errMessage)
    }

    if (signature === undefined || signature === '') {
      const errMessage = {
        status: 'error',
        data: {
          message: 'No signature is specified'
        }
      }
      return res.json(errMessage)
    }
    // Basic checks passed. First check if message is in our activeLoginPhrases collection

    MongoClient.connect(mongoUrl, function (err, db) {
      if (err) {
        log.error('Cannot reach MongoDB')
        log.error(err)
        const errMessage = {
          status: 'error',
          data: {
            message: 'Cannot reach MongoDB'
          }
        }
        db.close()
        return res.json(errMessage)
      }
      let dbo = db.db(config.database.local.database)
      dbo.collection(config.database.local.collections.activeLoginPhrases).find({ loginPhrase: message })
        .toArray(function (err, result) {
          if (err) {
            log.error('Error verifying Login')
            log.error(err)
            const errMessage = {
              status: 'error',
              data: {
                message: 'Error verifying Login'
              }
            }
            db.close()
            return res.json(errMessage)
          }

          if (result[0] !== undefined) {
            // It is present in our database
            if (result[0].loginPhrase.substring(0, 13) < timestamp) {
              // Second verify that this address signed this message
              let valid = false
              try {
                valid = bitcoinMessage.verify(message, address, signature)
              } catch (error) {
                const errMessage = {
                  status: 'error',
                  data: {
                    message: 'Invalid signature'
                  }
                }
                return res.json(errMessage)
              }
              if (valid) {
                // Third associate that address, signature and message with our database
                // TODO signature hijacking? What if middleware guy knows all of this?
                // TODO do we want to have some timelimited logins? not needed now
                // Do we want to store sighash too? Nope we are verifying if provided signature is ok. In localStorage we are storing zelid, message, signature
                // const sighash = crypto
                //   .createHash('sha256')
                //   .update(signature)
                //   .digest('hex')
                const newLogin = {
                  zelid: address,
                  loginPhrase: message,
                  signature
                }
                dbo.collection(config.database.local.collections.loggedUsers).insertOne(newLogin, function (err, myres) {
                  if (err) {
                    log.error('Error Logging user')
                    log.error(err)
                    const errMessage = {
                      status: 'error',
                      data: {
                        message: 'Unable to login'
                      }
                    }
                    return res.json(errMessage)
                  } else {
                    db.close()
                    const message = {
                      status: 'success',
                      data: {
                        message: 'Successfully logged in'
                      }
                    }
                    return res.json(message)
                  }
                })
              } else {
                const errMessage = {
                  status: 'error',
                  data: {
                    message: 'Invalid signature.'
                  }
                }
                db.close()
                return res.json(errMessage)
              }
            } else {
              const errMessage = {
                status: 'error',
                data: {
                  message: 'Signed message is no longer valid. Please request a new one.'
                }
              }
              db.close()
              return res.json(errMessage)
            }
          } else {
            const errMessage = {
              status: 'error',
              data: {
                message: 'Signed message is no longer valid. Please request a new one.'
              }
            }
            db.close()
            return res.json(errMessage)
          }
        })
    })
  })
}

function activeLoginPhrases(res) {
  /* const activeLoginPhrases = [
     {
       loginPhrase: 1565356121335e9obp7h17bykbbvub0ts488wnnmd12fe1pq88mq0v,
       createdAt: 2019-08-09T13:08:41.335Z,
       expireAt: 2019-08-09T13:23:41.335Z
     }
  ] */
  MongoClient.connect(mongoUrl, function (err, db) {
    if (err) {
      log.error('Cannot reach MongoDB')
      log.error(err)
      const errMessage = {
        status: 'error',
        data: {
          message: 'Cannot reach MongoDB'
        }
      }
      return res.json(errMessage)
    }
    let dbo = db.db(config.database.local.database)
    dbo.collection(config.database.local.collections.activeLoginPhrases).find({}, { projection: { _id: 0, loginPhrase: 1, createdAt: 1, expireAt: 1 } })
      .toArray(function (err, result) {
        if (err) {
          log.error('Error accessing local zelID collection')
          log.error(err)
          const errMessage = {
            status: 'error',
            data: {
              message: 'Error accessing local zelID collection.'
            }
          }
          db.close()
          return res.status(500).json(errMessage)
        }
        db.close()
        return res.json(result)
      })
  })
}

function loggedUsers(res) {
  // TODO make this protected api
  // responds with { zelid: 1btc, message: dddasd }
  MongoClient.connect(mongoUrl, function (err, db) {
    if (err) {
      log.error('Cannot reach MongoDB')
      log.error(err)
      const errMessage = {
        status: 'error',
        data: {
          message: 'Cannot reach MongoDB'
        }
      }
      return res.json(errMessage)
    }
    let dbo = db.db(config.database.local.database)
    dbo.collection(config.database.local.collections.loggedUsers).find({}, { projection: { _id: 0, zelid: 1, loginPhrase: 1 } })
      .toArray(function (err, result) {
        if (err) {
          log.error('Error accessing local zelID collection')
          log.error(err)
          const errMessage = {
            status: 'error',
            data: {
              message: 'Error accessing local zelID collection.'
            }
          }
          db.close()
          return res.json(errMessage)
        }
        db.close()
        return res.json(result)
      })
  })
}

// function verifySession(session) {
//   return true
// }

function wsRespondLoginPhrase(ws, req) {
  const loginphrase = req.params.loginphrase
  console.log(loginphrase)
  // respond with object containing address and signature to received message

  MongoClient.connect(mongoUrl, function (err, db) {
    if (err) {
      log.error('Cannot reach MongoDB')
      log.error(err)
      const errMessage = {
        status: 'error',
        data: {
          message: 'Cannot reach MongoDB'
        }
      }
      ws.send(qs.stringify(errMessage))
      ws.close()
    }
    let dbo = db.db(config.database.local.database)
    function searchDatabase() {
      dbo.collection(config.database.local.collections.loggedUsers).find({ loginPhrase: loginphrase })
        .toArray(function (err, result) {
          if (err) {
            log.error('Error looking for Login')
            log.error(err)
            const errMessage = {
              status: 'error',
              data: {
                message: 'Error looking for Login'
              }
            }
            db.close()
            ws.send(qs.stringify(errMessage))
            ws.close()
          }

          if (result[0] !== undefined) {
            // user is logged, all ok
            const message = {
              status: 'success',
              data: {
                message: 'Successfully logged in',
                zelid: result[0].zelid,
                loginPhrase: result[0].loginPhrase,
                signature: result[0].signature
              }
            }
            ws.send(qs.stringify(message))
            ws.close()
            db.close()
          } else {
            // check if this loginPhrase is still active. If so rerun this searching process
            dbo.collection(config.database.local.collections.activeLoginPhrases).find({ loginPhrase: loginphrase })
              .toArray(function (err, result) {
                if (err) {
                  log.error('Error searching for login phrase')
                  log.error(err)
                  const errMessage = {
                    status: 'error',
                    data: {
                      message: 'Error searching for login phrase'
                    }
                  }
                  db.close()
                  ws.send(qs.stringify(errMessage))
                  ws.close()
                }
                if (result[0] !== undefined) {
                  setTimeout(() => {
                    searchDatabase()
                  }, 500)
                } else {
                  const errMessage = {
                    status: 'error',
                    data: {
                      message: 'Signed message is no longer valid. Please request a new one.'
                    }
                  }
                  db.close()
                  ws.send(qs.stringify(errMessage))
                  ws.close()
                }
              })
          }
        })
    }
    searchDatabase()
  })
}

module.exports = {
  loginPhrase: loginPhrase,
  verifyLogin: verifyLogin,
  activeLoginPhrases: activeLoginPhrases,
  loggedUsers: loggedUsers,
  wsRespondLoginPhrase: wsRespondLoginPhrase
}
